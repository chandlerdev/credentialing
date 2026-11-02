package com.zmartcredential.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zmartcredential.entity.StorageSettings;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.repository.StorageSettingsRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.AuthPrincipal;
import com.zmartcredential.security.Role;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.security.PrivateKey;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.stream.Collectors;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Document storage in OneDrive / SharePoint through Microsoft Graph (super admin → Storage). The server signs in as an
 * app registration (tenant id, client id, client secret; application permission Sites.Selected with write access to the
 * site), finds the site and document library from the URL, and saves files under the chosen folder:
 * {folder}/{organization}/Providers/{provider (NPI)}/{Documents | Additional Documents | Enrollments/{payer}}/{file}.
 * Missing sub-folders are created by Graph. Files keep their key "onedrive:{driveId}:{itemId}".
 */
@Slf4j
@Service
public class OneDriveService {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15))
            .followRedirects(HttpClient.Redirect.NORMAL).build();
    private static final long SIMPLE_UPLOAD_MAX = 4L * 1024 * 1024;
    private static final int CHUNK = 320 * 1024 * 16; // 5 MiB, a multiple of 320 KiB as Graph requires
    public static final String KEY_PREFIX = "onedrive:";

    private final StorageSettingsRepository repository;
    private final CryptoService crypto;
    private final AuthContext authContext;
    /** Microsoft sign-in and Graph addresses (only changed for testing against a stand-in server). */
    private final String loginUrl;
    private final String graphUrl;

    private volatile String token;
    private volatile Instant tokenExpires = Instant.EPOCH;
    private volatile String tokenFor = "";

    private final com.zmartcredential.config.AppProperties props;

    public OneDriveService(StorageSettingsRepository repository, CryptoService crypto, AuthContext authContext, com.zmartcredential.config.AppProperties props,
                           @Value("${app.onedrive.login-url:https://login.microsoftonline.com}") String loginUrl,
                           @Value("${app.onedrive.graph-url:https://graph.microsoft.com}") String graphUrl) {
        this.repository = repository;
        this.crypto = crypto;
        this.authContext = authContext;
        this.props = props;
        this.loginUrl = loginUrl.replaceAll("/+$", "");
        this.graphUrl = graphUrl.replaceAll("/+$", "") + "/v1.0";
    }

    // ------------------------------------------------------------------ settings (super admin → Storage)

    /** authMethod: secret | certificate. folder: the saved folder, else the default one (created automatically). */
    public record SettingsView(boolean enabled, String authMethod, String tenantId, String clientId, boolean clientSecretSet, LocalDate secretExpires,
                               boolean certificateSet, String certThumbprint, String certSubject, LocalDate certExpires,
                               String siteUrl, String library, String folder, String folderUrl, boolean connected,
                               LocalDateTime lastUploadAt, String lastUploadName, Boolean lastUploadOk, String lastUploadError) {
    }

    public record SettingsRequest(Boolean enabled, String authMethod, String tenantId, String clientId, String clientSecret, LocalDate secretExpires,
                                  String certThumbprint, String siteUrl, String library, String folder) {
    }

    @Transactional(readOnly = true)
    public SettingsView settings() {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        return view(repository.findById(StorageSettings.ID).orElse(null));
    }

    private SettingsView view(StorageSettings s) {
        if (s == null) return new SettingsView(false, "certificate", null, null, false, null, false, null, null, null, null, "Documents", defaultFolder(),
                null, false, null, null, null, null);
        return new SettingsView(Boolean.TRUE.equals(s.getEnabled()), method(s), s.getTenantId(), s.getClientId(), s.getClientSecretEnc() != null,
                s.getSecretExpires(), s.getCertKeyEnc() != null, s.getCertThumbprint(), s.getCertSubject(), s.getCertExpires(),
                s.getSiteUrl(), s.getLibrary(), s.getFolder() == null ? defaultFolder() : s.getFolder(), s.getFolderUrl(), s.getDriveId() != null,
                s.getLastUploadAt(), s.getLastUploadName(), s.getLastUploadOk(), s.getLastUploadError());
    }

    private static String method(StorageSettings s) {
        return s.getAuthMethod() != null ? s.getAuthMethod() : s.getClientSecretEnc() != null ? "secret" : "certificate";
    }

    /** "ZmartCredential/desssnext.desss-portfolio.com": each site files into its own folder, made automatically. */
    private String defaultFolder() {
        String host = "";
        try {
            host = props.publicUrl() == null ? "" : URI.create(props.publicUrl().trim()).getHost();
        } catch (Exception ignored) {
            // no public address
        }
        return "ZmartCredential/" + (host == null || host.isBlank() || "localhost".equals(host) ? "Local" : host);
    }

    /** Storage → upload the certificate (with its private key) used to sign in to Microsoft. */
    @Transactional
    public SettingsView uploadCertificate(String fileName, byte[] bytes, String password, String expectedThumbprint) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        if (bytes == null || bytes.length == 0) throw BadRequestException.onField("certificate", "Choose the certificate file (.pfx or .pem)");
        if (bytes.length > 100_000) throw BadRequestException.onField("certificate", "That file is too large for a certificate");
        MicrosoftCertificate.Parsed c = MicrosoftCertificate.parse(fileName, bytes, password);
        String want = MicrosoftCertificate.normalizeThumbprint(expectedThumbprint);
        if (!want.isEmpty() && !want.equals(c.thumbprint()))
            throw BadRequestException.onField("certThumbprint", "This certificate's thumbprint is " + c.thumbprint() + ", not " + want
                    + " — upload the certificate whose thumbprint Entra ID shows for the app");
        if (c.expires().isBefore(LocalDate.now())) throw BadRequestException.onField("certificate", "This certificate expired on " + c.expires());
        StorageSettings s = repository.findById(StorageSettings.ID).orElseGet(() -> {
            StorageSettings n = new StorageSettings();
            n.setId(StorageSettings.ID);
            n.setLibrary("Documents");
            return n;
        });
        try {
            s.setCertKeyEnc(crypto.encrypt(Base64.getEncoder().encodeToString(c.key().getEncoded())));
            s.setCertDer(Base64.getEncoder().encodeToString(c.cert().getEncoded()));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        s.setCertThumbprint(c.thumbprint());
        s.setCertSubject(c.subject().length() > 300 ? c.subject().substring(0, 300) : c.subject());
        s.setCertExpires(c.expires());
        s.setAuthMethod("certificate");
        token = null;
        return view(repository.save(s));
    }

    /** Saves the settings; turning OneDrive on first checks them with Microsoft (sign-in, site, library, a test file). */
    @Transactional
    public SettingsView save(SettingsRequest r) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        StorageSettings s = repository.findById(StorageSettings.ID).orElseGet(() -> {
            StorageSettings n = new StorageSettings();
            n.setId(StorageSettings.ID);
            return n;
        });
        String tenant = trim(r.tenantId()), client = trim(r.clientId()), secret = trim(r.clientSecret());
        // the sign-in chosen on the page; when not given: a client secret if that is what was sent / saved, else the certificate
        String authMethod = r.authMethod() != null ? ("secret".equals(r.authMethod()) ? "secret" : "certificate")
                : secret != null || (s.getClientSecretEnc() != null && s.getCertKeyEnc() == null) ? "secret" : "certificate";
        String site = trim(r.siteUrl()), library = trim(r.library());
        String folder = r.folder() == null || r.folder().isBlank() ? defaultFolder() : cleanFolder(r.folder());
        String guid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
        if (tenant != null && !tenant.matches(guid) && !tenant.matches("[A-Za-z0-9.-]+\\.onmicrosoft\\.com"))
            throw BadRequestException.onField("tenantId", "Tenant ID is a GUID like 1a2b3c4d-1234-5678-9abc-1234567890ab");
        if (client != null && !client.matches(guid)) throw BadRequestException.onField("clientId", "Client ID is a GUID like 1a2b3c4d-1234-5678-9abc-1234567890ab");
        if (secret != null && secret.length() < 10) throw BadRequestException.onField("clientSecret", "Enter the client secret Value (not the Secret ID)");
        if (site != null && !site.matches("(?i)https://[a-z0-9-]+\\.sharepoint\\.com(/.*)?") && !site.matches("(?i)https?://.+"))
            throw BadRequestException.onField("siteUrl", "Enter the SharePoint site address, e.g. https://yourcompany.sharepoint.com/sites/Credentialing");
        if (r.folder() != null && !r.folder().isBlank() && folder == null)
            throw BadRequestException.onField("folder", "A folder name can't contain \" * : < > ? \\ | # %");

        String thumb = MicrosoftCertificate.normalizeThumbprint(r.certThumbprint());
        if ("certificate".equals(authMethod) && !thumb.isEmpty() && s.getCertThumbprint() != null && !thumb.equals(s.getCertThumbprint()))
            throw BadRequestException.onField("certThumbprint", "The uploaded certificate's thumbprint is " + s.getCertThumbprint() + ", not " + thumb + " — upload the matching certificate");
        boolean changed = !eq(authMethod, s.getAuthMethod()) || !eq(tenant, s.getTenantId()) || !eq(client, s.getClientId()) || secret != null || !eq(site, s.getSiteUrl())
                || !eq(library == null ? "Documents" : library, s.getLibrary()) || !eq(folder, s.getFolder());
        s.setAuthMethod(authMethod);
        s.setTenantId(tenant);
        s.setClientId(client);
        if (secret != null) s.setClientSecretEnc(crypto.encrypt(secret));
        s.setSecretExpires(r.secretExpires());
        s.setSiteUrl(site);
        s.setLibrary(library == null ? "Documents" : library);
        s.setFolder(folder);
        s.setEnabled(Boolean.TRUE.equals(r.enabled()));
        AuthPrincipal p = authContext.principal();
        s.setUpdatedBy(p.displayName() != null && !p.displayName().isBlank() ? p.displayName() : p.username());
        if (changed) {
            s.setSiteId(null);
            s.setDriveId(null);
            s.setFolderUrl(null);
            token = null;
        }
        if (Boolean.TRUE.equals(s.getEnabled())) {
            if (tenant == null) throw BadRequestException.onField("tenantId", "Tenant ID is required");
            if (client == null) throw BadRequestException.onField("clientId", "Client ID is required");
            if ("secret".equals(authMethod) && s.getClientSecretEnc() == null) throw BadRequestException.onField("clientSecret", "Client secret is required");
            if ("certificate".equals(authMethod) && s.getCertKeyEnc() == null) throw BadRequestException.onField("certificate", "Upload the certificate (.pfx or .pem with the private key)");
            if ("certificate".equals(authMethod) && s.getCertExpires() != null && s.getCertExpires().isBefore(LocalDate.now()))
                throw BadRequestException.onField("certificate", "The certificate expired on " + s.getCertExpires() + " — upload a new one");
            if (site == null) throw BadRequestException.onField("siteUrl", "SharePoint site address is required");
            if (folder == null) throw BadRequestException.onField("folder", "Folder is required (e.g. ZmartCredential/Testing)");
            connect(s);
        }
        return view(repository.save(s));
    }

    /** Checks the saved settings again with Microsoft and uploads (then deletes) a small test file. */
    @Transactional
    public SettingsView test() {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        StorageSettings s = repository.findById(StorageSettings.ID).orElseThrow(() -> new BadRequestException("Save the settings first"));
        if ((s.getClientSecretEnc() == null && s.getCertKeyEnc() == null) || s.getSiteUrl() == null) throw new BadRequestException("Save the settings first");
        token = null;
        connect(s);
        return view(repository.save(s));
    }

    /** Signs in, finds the site and library, then writes and removes a test file in the folder. */
    private void connect(StorageSettings s) {
        String t = accessToken(s);
        URI site = URI.create(s.getSiteUrl().replaceAll("/+$", ""));
        String path = site.getPath() == null || site.getPath().isBlank() || "/".equals(site.getPath()) ? "" : ":" + encodePath(site.getPath());
        JsonNode siteNode = graph("GET", graphUrl + "/sites/" + site.getHost() + path, t, null, "siteUrl",
                "Site not found, or the app has no access to it (grant it the site with Sites.Selected)");
        s.setSiteId(siteNode.path("id").asText());
        JsonNode drives = graph("GET", graphUrl + "/sites/" + s.getSiteId() + "/drives", t, null, "library", "Could not list the site's document libraries");
        JsonNode drive = null;
        for (JsonNode d : drives.path("value")) {
            if (d.path("name").asText().equalsIgnoreCase(s.getLibrary()) || ("Documents".equalsIgnoreCase(s.getLibrary()) && "Shared Documents".equalsIgnoreCase(d.path("name").asText()))) {
                drive = d;
                break;
            }
        }
        if (drive == null) {
            String names = java.util.stream.StreamSupport.stream(drives.path("value").spliterator(), false).map(d -> d.path("name").asText()).collect(Collectors.joining(", "));
            throw BadRequestException.onField("library", "No document library named \"" + s.getLibrary() + "\" on that site" + (names.isEmpty() ? "" : " (found: " + names + ")"));
        }
        s.setDriveId(drive.path("id").asText());
        // write access: put a small file in the folder (creates the folder) and remove it
        String probe = s.getFolder() + "/_zmartcredential-connection-test.txt";
        JsonNode item = graph("PUT", graphUrl + "/drives/" + s.getDriveId() + "/root:" + encodePath("/" + probe) + ":/content", t,
                HttpRequest.BodyPublishers.ofString("ZmartCredential connection test " + Instant.now()), "folder",
                "Could not write to the folder — the app needs write access to the site");
        graph("DELETE", graphUrl + "/drives/" + s.getDriveId() + "/items/" + item.path("id").asText(), t, null, "folder", "Could not delete the test file");
        JsonNode folderNode = graph("GET", graphUrl + "/drives/" + s.getDriveId() + "/root:" + encodePath("/" + s.getFolder()), t, null, "folder", "Could not open the folder");
        s.setFolderUrl(folderNode.path("webUrl").asText(null));
    }

    // ------------------------------------------------------------------ files

    /** Whether uploads go to OneDrive (on, and the site / library were found). */
    @Transactional(readOnly = true)
    public boolean active() {
        return repository.findById(StorageSettings.ID).map(s -> Boolean.TRUE.equals(s.getEnabled()) && s.getDriveId() != null).orElse(false);
    }

    /** Uploads into {folder}/{subPath}/{fileName} (a name taken gets " 1", " 2"…); returns the storage key. */
    public String upload(String subPath, String fileName, InputStream in, long size) throws Exception {
        StorageSettings s = repository.findById(StorageSettings.ID).orElseThrow();
        String t = accessToken(s);
        String path = encodePath("/" + s.getFolder() + "/" + subPath + "/" + cleanName(fileName));
        JsonNode item;
        if (size <= SIMPLE_UPLOAD_MAX) {
            item = graph("PUT", graphUrl + "/drives/" + s.getDriveId() + "/root:" + path + ":/content?@microsoft.graph.conflictBehavior=rename", t,
                    HttpRequest.BodyPublishers.ofByteArray(in.readAllBytes()), null, "Upload failed");
        } else {
            JsonNode session = graph("POST", graphUrl + "/drives/" + s.getDriveId() + "/root:" + path + ":/createUploadSession", t,
                    HttpRequest.BodyPublishers.ofString("{\"item\":{\"@microsoft.graph.conflictBehavior\":\"rename\"}}"), null, "Upload failed");
            String uploadUrl = session.path("uploadUrl").asText();
            item = null;
            byte[] buf = new byte[CHUNK];
            long sent = 0;
            while (sent < size) {
                int n = in.readNBytes(buf, 0, (int) Math.min(CHUNK, size - sent));
                if (n <= 0) throw new IllegalStateException("The file ended early");
                HttpResponse<String> res = HTTP.send(HttpRequest.newBuilder(URI.create(uploadUrl)).timeout(Duration.ofMinutes(2))
                        .header("Content-Range", "bytes " + sent + "-" + (sent + n - 1) + "/" + size)
                        .PUT(HttpRequest.BodyPublishers.ofByteArray(Arrays.copyOf(buf, n))).build(), HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() / 100 != 2) throw new IllegalStateException("Upload failed (" + res.statusCode() + ")");
                sent += n;
                if (res.statusCode() == 200 || res.statusCode() == 201) item = JSON.readTree(res.body());
            }
            if (item == null) throw new IllegalStateException("Upload did not complete");
        }
        return KEY_PREFIX + s.getDriveId() + ":" + item.path("id").asText();
    }

    public byte[] download(String key) throws Exception {
        String[] k = parse(key);
        StorageSettings s = repository.findById(StorageSettings.ID).orElseThrow(() -> new IllegalStateException("OneDrive storage is not set up"));
        HttpResponse<byte[]> res = HTTP.send(HttpRequest.newBuilder(URI.create(graphUrl + "/drives/" + k[0] + "/items/" + k[1] + "/content"))
                .header("Authorization", "Bearer " + accessToken(s)).timeout(Duration.ofMinutes(2)).GET().build(), HttpResponse.BodyHandlers.ofByteArray());
        if (res.statusCode() == 404) throw new com.zmartcredential.exception.NotFoundException("File not found in OneDrive");
        if (res.statusCode() / 100 != 2) throw new IllegalStateException("OneDrive download failed (" + res.statusCode() + ")");
        return res.body();
    }

    public void delete(String key) {
        try {
            String[] k = parse(key);
            StorageSettings s = repository.findById(StorageSettings.ID).orElse(null);
            if (s == null) return;
            HTTP.send(HttpRequest.newBuilder(URI.create(graphUrl + "/drives/" + k[0] + "/items/" + k[1]))
                    .header("Authorization", "Bearer " + accessToken(s)).timeout(Duration.ofSeconds(30)).DELETE().build(), HttpResponse.BodyHandlers.discarding());
        } catch (Exception e) {
            log.warn("OneDrive delete of {} failed: {}", key, e.getMessage());
        }
    }

    /** The last upload's result, shown on the Storage page (kept even when the upload itself failed). */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordUpload(String name, boolean ok, String error) {
        repository.findById(StorageSettings.ID).ifPresent(s -> {
            s.setLastUploadAt(LocalDateTime.now());
            s.setLastUploadName(name == null ? null : name.length() > 500 ? name.substring(0, 500) : name);
            s.setLastUploadOk(ok);
            s.setLastUploadError(error == null ? null : error.length() > 1000 ? error.substring(0, 1000) : error);
            repository.save(s);
        });
    }

    // ------------------------------------------------------------------ Microsoft sign-in and Graph

    /** An app-only token (client credentials), cached until shortly before it expires. */
    private String accessToken(StorageSettings s) {
        boolean cert = "certificate".equals(method(s));
        String who = s.getTenantId() + "|" + s.getClientId() + "|" + (cert ? s.getCertThumbprint() : s.getClientSecretEnc());
        if (token != null && who.equals(tokenFor) && Instant.now().isBefore(tokenExpires)) return token;
        String tokenUrl = loginUrl + "/" + s.getTenantId() + "/oauth2/v2.0/token";
        Map<String, String> f = new LinkedHashMap<>();
        f.put("client_id", s.getClientId());
        f.put("scope", "https://graph.microsoft.com/.default");
        f.put("grant_type", "client_credentials");
        if (cert) {
            // the certificate: a client assertion signed with its private key (Microsoft checks it with the public part in Entra ID)
            PrivateKey key = MicrosoftCertificate.key(Base64.getDecoder().decode(crypto.decrypt(s.getCertKeyEnc())));
            f.put("client_assertion_type", "urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
            f.put("client_assertion", MicrosoftCertificate.assertion(key, s.getCertThumbprint(), s.getClientId(),
                    "https://login.microsoftonline.com/" + s.getTenantId() + "/oauth2/v2.0/token"));
        } else {
            f.put("client_secret", crypto.decrypt(s.getClientSecretEnc()));
        }
        String body = form(f);
        try {
            HttpResponse<String> res = HTTP.send(HttpRequest.newBuilder(URI.create(tokenUrl))
                    .timeout(Duration.ofSeconds(30)).header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(body)).build(), HttpResponse.BodyHandlers.ofString());
            JsonNode n = JSON.readTree(res.body().isBlank() ? "{}" : res.body());
            if (res.statusCode() / 100 != 2 || !n.hasNonNull("access_token")) {
                String err = n.path("error_description").asText(n.path("error").asText("HTTP " + res.statusCode()));
                String field = err.contains("AADSTS700016") ? "clientId" : err.contains("AADSTS90002") || err.contains("AADSTS900023") ? "tenantId"
                        : cert ? "certificate" : "clientSecret";
                throw BadRequestException.onField(field, "Microsoft sign-in failed: " + firstLine(err));
            }
            token = n.get("access_token").asText();
            tokenExpires = Instant.now().plusSeconds(Math.max(60, n.path("expires_in").asLong(3600) - 120));
            tokenFor = who;
            return token;
        } catch (BadRequestException e) {
            throw e;
        } catch (Exception e) {
            throw new BadRequestException("Could not reach Microsoft sign-in: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    /** A Graph call; a refusal becomes a field error on the settings page. */
    private JsonNode graph(String method, String url, String bearer, HttpRequest.BodyPublisher body, String field, String message) {
        try {
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).header("Authorization", "Bearer " + bearer);
            if (body != null) b.header("Content-Type", method.equals("POST") ? "application/json" : "application/octet-stream");
            b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : body);
            HttpResponse<String> res = HTTP.send(b.build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                String detail = "";
                try {
                    detail = JSON.readTree(res.body()).path("error").path("message").asText("");
                } catch (Exception ignored) {
                    // not JSON
                }
                String msg = message + " (" + res.statusCode() + (detail.isBlank() ? "" : ": " + firstLine(detail)) + ")";
                throw field == null ? new IllegalStateException(msg) : BadRequestException.onField(field, msg);
            }
            return res.body() == null || res.body().isBlank() ? JSON.createObjectNode() : JSON.readTree(res.body());
        } catch (BadRequestException | IllegalStateException e) {
            throw e;
        } catch (Exception e) {
            String msg = "Could not reach Microsoft Graph: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            throw field == null ? new IllegalStateException(msg) : new BadRequestException(msg);
        }
    }

    // ------------------------------------------------------------------ helpers

    private static String[] parse(String key) {
        String[] k = key.substring(KEY_PREFIX.length()).split(":", 2);
        if (k.length != 2) throw new IllegalArgumentException("Bad OneDrive key");
        return k;
    }

    /** Each path segment URL-encoded ("/a b/c" → "/a%20b/c"). */
    static String encodePath(String path) {
        return Arrays.stream(path.split("/")).filter(x -> !x.isEmpty())
                .map(x -> URLEncoder.encode(x, StandardCharsets.UTF_8).replace("+", "%20"))
                .collect(Collectors.joining("/", "/", ""));
    }

    /** A file or folder name SharePoint accepts: without " * : < > ? / \ | # %, no leading / trailing dots or spaces. */
    public static String cleanName(String name) {
        String n = name == null ? "" : name.replaceAll("[\"*:<>?/\\\\|#%\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        n = n.replaceAll("^[.\\s]+|[.\\s]+$", "");
        if (n.isEmpty()) n = "file";
        return n.length() > 150 ? n.substring(0, 150).trim() : n;
    }

    /** "ZmartCredential / Testing/" → "ZmartCredential/Testing"; null when empty or invalid. */
    static String cleanFolder(String folder) {
        if (folder == null || folder.isBlank()) return null;
        if (folder.matches(".*[\"*:<>?\\\\|#%].*")) return null;
        String f = Arrays.stream(folder.split("/")).map(String::trim).filter(x -> !x.isEmpty()).collect(Collectors.joining("/"));
        return f.isEmpty() ? null : f;
    }

    private static String form(Map<String, String> m) {
        return m.entrySet().stream().map(e -> URLEncoder.encode(e.getKey(), StandardCharsets.UTF_8) + "=" + URLEncoder.encode(e.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }

    private static String firstLine(String s) {
        String l = s.split("\\r?\\n")[0];
        return l.length() > 300 ? l.substring(0, 300) : l;
    }
    private static String trim(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static boolean eq(String a, String b) {
        return a == null ? b == null : a.equals(b);
    }

}
