package com.zmartcredential.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zmartcredential.exception.BadRequestException;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Collections;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Microsoft Entra ID sign-in with a certificate (app registration → Certificates & secrets → Certificates): reads the
 * certificate with its private key (.pfx / .p12 with its password, or a .pem holding the private key and the
 * certificate), gives its thumbprint (SHA-1, as Entra shows it), and signs the client assertion — a short-lived JWT
 * (RS256, header x5t = the thumbprint) sent instead of a client secret.
 */
public final class MicrosoftCertificate {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern PEM = Pattern.compile("-----BEGIN ([A-Z ]+)-----([A-Za-z0-9+/=\\s]+)-----END \\1-----");

    public record Parsed(PrivateKey key, X509Certificate cert, String thumbprint, String subject, LocalDate expires) {
    }

    private MicrosoftCertificate() {
    }

    /** The certificate and its private key from an uploaded .pfx / .p12 (with password) or .pem file. */
    public static Parsed parse(String fileName, byte[] bytes, String password) {
        String name = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        String text = new String(bytes, StandardCharsets.US_ASCII);
        PrivateKey key = null;
        X509Certificate cert = null;
        try {
            if (text.contains("-----BEGIN")) {
                Matcher m = PEM.matcher(text);
                while (m.find()) {
                    String type = m.group(1).trim();
                    byte[] der = Base64.getMimeDecoder().decode(m.group(2).replaceAll("\\s", ""));
                    switch (type) {
                        case "CERTIFICATE" -> {
                            if (cert == null) cert = (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(der));
                        }
                        case "PRIVATE KEY" -> key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
                        case "RSA PRIVATE KEY" -> key = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(pkcs1ToPkcs8(der)));
                        case "ENCRYPTED PRIVATE KEY" -> throw BadRequestException.onField("certificate",
                                "The private key in this .pem is password-protected — upload the .pfx instead, or export the key without a password");
                        default -> {
                            // other blocks (e.g. a chain's CA certificates after the first) are ignored
                        }
                    }
                }
                if (key == null && cert != null) throw BadRequestException.onField("certificate",
                        "This file is only the public part of the certificate (what was uploaded to Entra ID). Upload the .pfx (with its password) or a .pem that also has the private key");
                if (key == null) throw BadRequestException.onField("certificate", "This .pem has no private key — upload the .pfx, or a .pem with both the private key and the certificate");
                if (cert == null) throw BadRequestException.onField("certificate", "This .pem has no certificate — it needs both the private key and the certificate");
            } else if (name.endsWith(".cer") || name.endsWith(".crt")) {
                throw BadRequestException.onField("certificate", "A .cer / .crt file is only the public part (what was uploaded to Entra ID). Upload the .pfx (with its password) that holds the private key");
            } else {
                KeyStore ks = KeyStore.getInstance("PKCS12");
                char[] pw = password == null ? new char[0] : password.toCharArray();
                try {
                    ks.load(new ByteArrayInputStream(bytes), pw);
                } catch (java.io.IOException e) {
                    throw BadRequestException.onField("certificatePassword", "The certificate password is wrong (or this isn't a .pfx file)");
                }
                for (String alias : Collections.list(ks.aliases())) {
                    if (ks.isKeyEntry(alias)) {
                        key = (PrivateKey) ks.getKey(alias, pw);
                        cert = (X509Certificate) ks.getCertificate(alias);
                        break;
                    }
                }
                if (key == null || cert == null) throw BadRequestException.onField("certificate", "This .pfx has no private key");
            }
        } catch (BadRequestException e) {
            throw e;
        } catch (Exception e) {
            throw BadRequestException.onField("certificate", "Could not read the certificate: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()));
        }
        if (!(key instanceof RSAPrivateCrtKey rk) || !(cert.getPublicKey() instanceof RSAPublicKey pk))
            throw BadRequestException.onField("certificate", "Only RSA certificates can be used for Microsoft sign-in");
        if (!rk.getModulus().equals(pk.getModulus())) throw BadRequestException.onField("certificate", "The private key doesn't belong to this certificate");
        LocalDate expires = cert.getNotAfter().toInstant().atZone(ZoneId.systemDefault()).toLocalDate();
        return new Parsed(key, cert, thumbprint(cert), cert.getSubjectX500Principal().getName(), expires);
    }

    /** SHA-1 of the certificate, upper-case hex — the "Thumbprint" Entra ID shows. */
    public static String thumbprint(X509Certificate cert) {
        try {
            return HexFormat.of().withUpperCase().formatHex(MessageDigest.getInstance("SHA-1").digest(cert.getEncoded()));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** "ab cd:EF…" → "ABCDEF…" for comparing with what the user copied from Entra ID. */
    public static String normalizeThumbprint(String t) {
        return t == null ? "" : t.replaceAll("[^0-9A-Fa-f]", "").toUpperCase(Locale.ROOT);
    }

    /** The client assertion: a JWT signed with the private key, valid 10 minutes, for the token endpoint (aud). */
    public static String assertion(PrivateKey key, String thumbprintHex, String clientId, String audience) {
        try {
            Base64.Encoder b64 = Base64.getUrlEncoder().withoutPadding();
            Map<String, Object> header = new LinkedHashMap<>();
            header.put("alg", "RS256");
            header.put("typ", "JWT");
            header.put("x5t", b64.encodeToString(HexFormat.of().parseHex(thumbprintHex)));
            long now = Instant.now().getEpochSecond();
            Map<String, Object> claims = new LinkedHashMap<>();
            claims.put("aud", audience);
            claims.put("iss", clientId);
            claims.put("sub", clientId);
            claims.put("jti", UUID.randomUUID().toString());
            claims.put("nbf", now - 60);
            claims.put("iat", now);
            claims.put("exp", now + 600);
            String unsigned = b64.encodeToString(JSON.writeValueAsBytes(header)) + "." + b64.encodeToString(JSON.writeValueAsBytes(claims));
            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initSign(key);
            sig.update(unsigned.getBytes(StandardCharsets.UTF_8));
            return unsigned + "." + b64.encodeToString(sig.sign());
        } catch (Exception e) {
            throw new IllegalStateException("Could not sign the Microsoft sign-in request", e);
        }
    }

    public static PrivateKey key(byte[] pkcs8) {
        try {
            return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
        } catch (Exception e) {
            throw new IllegalStateException("The stored certificate key can't be read", e);
        }
    }

    /** "BEGIN RSA PRIVATE KEY" (PKCS#1) wrapped as PKCS#8: SEQ { 0, SEQ { rsaEncryption, NULL }, OCTET STRING pkcs1 }. */
    private static byte[] pkcs1ToPkcs8(byte[] pkcs1) {
        byte[] algId = {0x30, 0x0d, 0x06, 0x09, 0x2a, (byte) 0x86, 0x48, (byte) 0x86, (byte) 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00};
        byte[] version = {0x02, 0x01, 0x00};
        byte[] octet = tlv(0x04, pkcs1);
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.writeBytes(version);
        body.writeBytes(algId);
        body.writeBytes(octet);
        return tlv(0x30, body.toByteArray());
    }

    private static byte[] tlv(int tag, byte[] value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(tag);
        int len = value.length;
        if (len < 0x80) {
            out.write(len);
        } else if (len < 0x100) {
            out.write(0x81);
            out.write(len);
        } else if (len < 0x10000) {
            out.write(0x82);
            out.write(len >> 8);
            out.write(len & 0xff);
        } else {
            out.write(0x83);
            out.write(len >> 16);
            out.write((len >> 8) & 0xff);
            out.write(len & 0xff);
        }
        out.writeBytes(value);
        return out.toByteArray();
    }
}
