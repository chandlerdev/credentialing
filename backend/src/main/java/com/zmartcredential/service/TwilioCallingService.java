package com.zmartcredential.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zmartcredential.entity.CallSession;
import com.zmartcredential.entity.Enrollment;
import com.zmartcredential.entity.CallingSettings;
import com.zmartcredential.entity.Payer;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.exception.ForbiddenException;
import com.zmartcredential.exception.NotFoundException;
import com.zmartcredential.repository.CallSessionRepository;
import com.zmartcredential.repository.EnrollmentRepository;
import com.zmartcredential.repository.CallingSettingsRepository;
import com.zmartcredential.repository.PayerRepository;
import com.zmartcredential.security.AuthContext;
import com.zmartcredential.security.PermissionService;
import com.zmartcredential.security.Role;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Browser calling through Twilio (Payer Submission → Call). The super admin enters one Twilio account for every
 * organization in Communication (Account SID, API Key SID / Secret, Auth Token, Twilio number); on save it is checked with Twilio and a TwiML
 * App is created whose Voice URL is our /api/public/twilio/voice. The browser gets a short-lived access token and
 * places the call; Twilio asks our Voice URL what to do and we dial the payer's Support Phone — only that number, for
 * that enrollment — from the Twilio number. The payer's answer (completed / busy / no-answer …) comes back on the dial
 * result URL. Webhooks are verified with the X-Twilio-Signature (HMAC-SHA1 with the Auth Token). Nothing is recorded.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class TwilioCallingService {

    private static final String API = "https://api.twilio.com/2010-04-01";
    private static final String VOICE_PATH = "/api/public/twilio/voice";
    private static final String DIAL_RESULT_PATH = "/api/public/twilio/dial-result";
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    private final CallingSettingsRepository settingsRepository;
    private final CallSessionRepository sessionRepository;
    private final EnrollmentRepository enrollmentRepository;
    private final PayerRepository payerRepository;
    private final com.zmartcredential.repository.AppUserRepository userRepository;
    private final CryptoService crypto;
    private final MailService mailService;
    private final AuthContext authContext;
    private final PermissionService permissionService;
    private final EnrollmentSupport support;

    /** Testing only: save the settings without checking them with Twilio. */
    @Value("${app.calling.skip-verify:false}")
    private boolean skipVerify;

    // ------------------------------------------------------------------ settings (super admin → Communication)

    public record SettingsView(boolean enabled, String accountSid, String apiKeySid, boolean apiKeySecretSet, boolean authTokenSet,
                               String phoneNumber, String twimlAppSid, String voiceUrl) {
    }

    public record SettingsRequest(Boolean enabled, String accountSid, String apiKeySid, String apiKeySecret, String authToken, String phoneNumber) {
    }

    @Transactional(readOnly = true)
    public SettingsView settings() {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        return view(settingsRepository.findById(CallingSettings.ID).orElse(null));
    }

    private SettingsView view(CallingSettings s) {
        String voiceUrl = mailService.publicUrl() + VOICE_PATH;
        if (s == null) return new SettingsView(false, null, null, false, false, null, null, voiceUrl);
        return new SettingsView(Boolean.TRUE.equals(s.getEnabled()), s.getAccountSid(), s.getApiKeySid(), s.getApiKeySecretEnc() != null,
                s.getAuthTokenEnc() != null, display(s.getPhoneNumber()), s.getTwimlAppSid(), voiceUrl);
    }

    /** Saves the account; when calling is on it is checked with Twilio and the TwiML App is created / updated. */
    @Transactional
    public SettingsView save(SettingsRequest r) {
        authContext.requireRole(Role.PLATFORM_ADMIN);
        CallingSettings s = settingsRepository.findById(CallingSettings.ID).orElseGet(() -> {
            CallingSettings n = new CallingSettings();
            n.setId(CallingSettings.ID);
            return n;
        });
        boolean enabled = Boolean.TRUE.equals(r.enabled());
        String accountSid = trim(r.accountSid()), apiKeySid = trim(r.apiKeySid());
        String secret = trim(r.apiKeySecret()), token = trim(r.authToken());
        String phone = e164(r.phoneNumber());

        if (accountSid != null && !accountSid.matches("AC[0-9a-fA-F]{32}")) throw BadRequestException.onField("accountSid", "Account SID starts with AC followed by 32 characters");
        if (apiKeySid != null && !apiKeySid.matches("SK[0-9a-fA-F]{32}")) throw BadRequestException.onField("apiKeySid", "API Key SID starts with SK followed by 32 characters");
        if (secret != null && !secret.matches("[A-Za-z0-9]{20,64}")) throw BadRequestException.onField("apiKeySecret", "Enter the API Key Secret shown when the key was created");
        if (token != null && !token.matches("[0-9a-fA-F]{32}")) throw BadRequestException.onField("authToken", "Auth Token is 32 characters (Twilio Console → Account info)");
        if (r.phoneNumber() != null && !r.phoneNumber().isBlank() && phone == null) throw BadRequestException.onField("phoneNumber", "Enter the Twilio number (+1 and 10 digits)");

        s.setAccountSid(accountSid);
        s.setApiKeySid(apiKeySid);
        if (secret != null) s.setApiKeySecretEnc(crypto.encrypt(secret));
        if (token != null) s.setAuthTokenEnc(crypto.encrypt(token));
        s.setPhoneNumber(phone);
        s.setEnabled(enabled);
        s.setUpdatedBy(support.actorLabel());

        if (enabled) {
            if (accountSid == null) throw BadRequestException.onField("accountSid", "Account SID is required");
            if (apiKeySid == null) throw BadRequestException.onField("apiKeySid", "API Key SID is required");
            if (s.getApiKeySecretEnc() == null) throw BadRequestException.onField("apiKeySecret", "API Key Secret is required");
            if (s.getAuthTokenEnc() == null) throw BadRequestException.onField("authToken", "Auth Token is required");
            if (phone == null) throw BadRequestException.onField("phoneNumber", "Twilio phone number is required");
            if (mailService.publicUrl().isBlank()) throw new BadRequestException("The server's public address (app.public-url) is not set, so Twilio can't reach it");
            if (!skipVerify) verifyAndConnect(s);
            else if (s.getTwimlAppSid() == null) s.setTwimlAppSid("AP" + "0".repeat(32)); // testing only
        }
        return view(settingsRepository.save(s));
    }

    /** Checks the Auth Token, the API key and the number with Twilio, then creates / updates the TwiML App. */
    private void verifyAndConnect(CallingSettings s) {
        String sid = s.getAccountSid(), token = crypto.decrypt(s.getAuthTokenEnc());
        if (get(sid, token, "/Accounts/" + sid + ".json") == null) throw BadRequestException.onField("authToken", "Twilio rejected the Account SID / Auth Token");
        // a Standard API key can't read the Account resource itself (Twilio only lets the Auth Token / Main keys do that),
        // so the key is checked on a resource every key may read: the account's applications
        if (get(s.getApiKeySid(), crypto.decrypt(s.getApiKeySecretEnc()), "/Accounts/" + sid + "/Applications.json?PageSize=1") == null)
            throw BadRequestException.onField("apiKeySecret", "Twilio rejected the API Key SID / Secret (the key must belong to this account)");
        String q = "?PhoneNumber=" + URLEncoder.encode(s.getPhoneNumber(), StandardCharsets.UTF_8);
        JsonNode owned = get(sid, token, "/Accounts/" + sid + "/IncomingPhoneNumbers.json" + q);
        JsonNode verified = get(sid, token, "/Accounts/" + sid + "/OutgoingCallerIds.json" + q);
        boolean ok = (owned != null && owned.path("incoming_phone_numbers").size() > 0) || (verified != null && verified.path("outgoing_caller_ids").size() > 0);
        if (!ok) throw BadRequestException.onField("phoneNumber", "This number isn't a Twilio number (or verified caller ID) of this account");

        Map<String, String> form = new LinkedHashMap<>();
        // one calling app per site (testing / live) in the same Twilio account: each has its own Voice URL
        form.put("FriendlyName", "ZmartCredential calling - " + URI.create(mailService.publicUrl()).getHost());
        form.put("VoiceUrl", mailService.publicUrl() + VOICE_PATH);
        form.put("VoiceMethod", "POST");
        JsonNode app = null;
        if (s.getTwimlAppSid() != null) app = post(sid, token, "/Accounts/" + sid + "/Applications/" + s.getTwimlAppSid() + ".json", form);
        if (app == null) app = post(sid, token, "/Accounts/" + sid + "/Applications.json", form);
        if (app == null || app.path("sid").asText().isEmpty()) throw new BadRequestException("Twilio didn't create the calling app — check the account's permissions");
        s.setTwimlAppSid(app.path("sid").asText());
    }

    // ------------------------------------------------------------------ browser token

    public record TokenView(boolean enabled, String token, String identity, String callerId) {
    }

    /** Payer Submission → Call: whether browser calling is on, and an access token (1 hour) for the Twilio Voice SDK. */
    @Transactional(readOnly = true)
    public TokenView token(boolean issue) {
        authContext.requireStaff();
        CallingSettings s = settingsRepository.findById(CallingSettings.ID).orElse(null);
        if (s == null || !Boolean.TRUE.equals(s.getEnabled()) || s.getTwimlAppSid() == null) return new TokenView(false, null, null, null);
        if (!issue) return new TokenView(true, null, null, display(s.getPhoneNumber()));
        permissionService.require("enrollment", "update");
        String identity = "u" + authContext.orgId() + "-" + authContext.userId();
        return new TokenView(true, accessToken(s.getAccountSid(), s.getApiKeySid(), crypto.decrypt(s.getApiKeySecretEnc()), s.getTwimlAppSid(), identity, 3600),
                identity, display(s.getPhoneNumber()));
    }

    /** A Twilio access token (JWT, HS256 with the API Key Secret) with an outgoing voice grant. */
    static String accessToken(String accountSid, String keySid, String keySecret, String appSid, String identity, int ttlSeconds) {
        long now = Instant.now().getEpochSecond();
        Map<String, Object> header = new LinkedHashMap<>();
        header.put("typ", "JWT");
        header.put("alg", "HS256");
        header.put("cty", "twilio-fpa;v=1");
        Map<String, Object> voice = new LinkedHashMap<>();
        voice.put("incoming", Map.of("allow", false));
        voice.put("outgoing", Map.of("application_sid", appSid));
        Map<String, Object> grants = new LinkedHashMap<>();
        grants.put("identity", identity);
        grants.put("voice", voice);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("jti", keySid + "-" + now);
        payload.put("iss", keySid);
        payload.put("sub", accountSid);
        payload.put("iat", now);
        payload.put("exp", now + ttlSeconds);
        payload.put("grants", grants);
        try {
            Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
            String unsigned = b64.encodeToString(JSON.writeValueAsBytes(header)) + "." + b64.encodeToString(JSON.writeValueAsBytes(payload));
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(keySecret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return unsigned + "." + b64.encodeToString(mac.doFinal(unsigned.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException("Could not create the calling token", e);
        }
    }

    // ------------------------------------------------------------------ Twilio webhooks (public, signed)

    /**
     * Twilio asks what to do with a browser call: dial the payer's Support Phone of the enrollment (and nothing else)
     * from the Twilio number. Returns TwiML.
     */
    @Transactional
    public String voice(Map<String, String> params, String signature) {
        CallingSettings s = signed(params, signature, VOICE_PATH);
        if (s == null) return null;
        // the caller (browser identity u<org>-<user>): an active user of that organization, calling about its enrollment
        java.util.regex.Matcher who = java.util.regex.Pattern.compile("^client:u(\\d+)-(\\d+)$").matcher(params.getOrDefault("From", ""));
        if (!who.matches()) return say("This call can't be placed.");
        Long orgId = Long.valueOf(who.group(1)), userId = Long.valueOf(who.group(2));
        if (userRepository.findByIdAndOrgId(userId, orgId).filter(u -> !Boolean.TRUE.equals(u.getDisabled())).isEmpty()) return say("This call can't be placed.");
        Long enrollmentId = parseLong(params.get("EnrollmentId"));
        Enrollment e = enrollmentId == null ? null : enrollmentRepository.findById(enrollmentId).orElse(null);
        if (e == null || !orgId.equals(e.getOrgId())) return say("This call can't be placed.");
        Payer p = payerRepository.findById(e.getPayerId()).orElse(null);
        String payerPhone = p == null ? null : e164(p.getSupportPhone());
        String to = e164(params.get("To"));
        if (payerPhone == null || !payerPhone.equals(to)) return say("This call can't be placed. The number is not the payer's support phone.");

        CallSession c = new CallSession();
        c.setCallSid(params.get("CallSid"));
        c.setOrgId(orgId);
        c.setEnrollmentId(e.getId());
        c.setUserId(userId);
        c.setToNumber(to);
        sessionRepository.save(c);
        String action = mailService.publicUrl() + DIAL_RESULT_PATH;
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Dial callerId=\"" + xml(s.getPhoneNumber()) + "\" answerOnBridge=\"true\" timeout=\"40\" action=\""
                + xml(action) + "\" method=\"POST\"><Number>" + xml(to) + "</Number></Dial></Response>";
    }

    /** Twilio reports the payer's answer (DialCallStatus) and how long they were connected. */
    @Transactional
    public String dialResult(Map<String, String> params, String signature) {
        CallingSettings s = signed(params, signature, DIAL_RESULT_PATH);
        if (s == null) return null;
        sessionRepository.findById(params.getOrDefault("CallSid", "")).ifPresent(c -> {
            c.setDialStatus(trimTo(params.get("DialCallStatus"), 20));
            c.setDialDuration(parseInt(params.get("DialCallDuration")));
            sessionRepository.save(c);
        });
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response/>";
    }

    /** The organization whose Auth Token signed this request, or null when the signature doesn't match. */
    private CallingSettings signed(Map<String, String> params, String signature, String path) {
        if (signature == null || signature.isBlank()) return null;
        String url = mailService.publicUrl() + path;
        for (CallingSettings s : settingsRepository.findByAccountSid(params.getOrDefault("AccountSid", ""))) {
            if (s.getAuthTokenEnc() == null || !Boolean.TRUE.equals(s.getEnabled())) continue;
            if (validSignature(crypto.decrypt(s.getAuthTokenEnc()), url, params, signature)) return s;
        }
        log.warn("Twilio webhook {} with an invalid signature (account {})", path, params.get("AccountSid"));
        return null;
    }

    /** Twilio's signature: Base64(HMAC-SHA1(authToken, url + each POST parameter name and value, sorted by name)). */
    static boolean validSignature(String authToken, String url, Map<String, String> params, String signature) {
        try {
            StringBuilder data = new StringBuilder(url);
            new TreeMap<>(params).forEach((k, v) -> data.append(k).append(v == null ? "" : v));
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(authToken.getBytes(StandardCharsets.UTF_8), "HmacSHA1"));
            String expected = Base64.getEncoder().encodeToString(mac.doFinal(data.toString().getBytes(StandardCharsets.UTF_8)));
            return MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8), signature.getBytes(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return false;
        }
    }

    // ------------------------------------------------------------------ the call's result (browser, after hang-up)

    public record SessionView(String callSid, String dialStatus, Integer dialDuration) {
    }

    @Transactional(readOnly = true)
    public SessionView session(String callSid) {
        authContext.requireStaff();
        CallSession c = sessionRepository.findById(callSid).filter(x -> x.getOrgId().equals(authContext.orgId()))
                .orElseThrow(() -> NotFoundException.of("Call", callSid));
        if (c.getUserId() != null && !c.getUserId().equals(authContext.userId())) throw new ForbiddenException("Not your call");
        return new SessionView(c.getCallSid(), c.getDialStatus(), c.getDialDuration());
    }

    // ------------------------------------------------------------------ helpers

    private static JsonNode get(String user, String pass, String path) {
        return send(HttpRequest.newBuilder(URI.create(API + path)).GET(), user, pass);
    }

    private static JsonNode post(String user, String pass, String path, Map<String, String> form) {
        String body = form.entrySet().stream().map(x -> URLEncoder.encode(x.getKey(), StandardCharsets.UTF_8) + "=" + URLEncoder.encode(x.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
        return send(HttpRequest.newBuilder(URI.create(API + path)).header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)), user, pass);
    }

    /** The JSON answer, or null when Twilio refused (wrong credentials, not found…). */
    private static JsonNode send(HttpRequest.Builder b, String user, String pass) {
        try {
            String auth = Base64.getEncoder().encodeToString((user + ":" + pass).getBytes(StandardCharsets.UTF_8));
            HttpResponse<String> res = HTTP.send(b.header("Authorization", "Basic " + auth).timeout(Duration.ofSeconds(20)).build(), HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() / 100 != 2) {
                log.info("Twilio {} → {}", b.build().uri().getPath(), res.statusCode());
                return null;
            }
            return JSON.readTree(res.body());
        } catch (Exception e) {
            throw new BadRequestException("Could not reach Twilio: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
    }

    /** "+1 8005550100" / "(800) 555-0100" → "+18005550100"; null when it isn't a US number. */
    static String e164(String v) {
        if (v == null) return null;
        String d = v.replaceAll("\\D", "");
        if (d.length() == 11 && d.startsWith("1")) d = d.substring(1);
        return d.length() == 10 ? "+1" + d : null;
    }

    private static String display(String e164) {
        return e164 == null ? null : e164.startsWith("+1") && e164.length() == 12 ? "+1 " + e164.substring(2) : e164;
    }

    private static String say(String text) {
        return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Say>" + xml(text) + "</Say><Hangup/></Response>";
    }

    private static String xml(String s) {
        return s == null ? "" : s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
    }

    private static String trim(String s) {
        return s == null || s.isBlank() ? null : s.trim();
    }

    private static String trimTo(String s, int n) {
        return s == null ? null : s.length() > n ? s.substring(0, n) : s;
    }

    private static Long parseLong(String s) {
        try {
            return s == null ? null : Long.valueOf(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static Integer parseInt(String s) {
        try {
            return s == null ? null : Integer.valueOf(s.trim());
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
