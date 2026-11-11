package com.zmartcredential.dto.caqh;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/** CAQH provider lookup ("Import from CAQH") and its mock / real API configuration. */
public final class CaqhLookupDtos {

    private CaqhLookupDtos() {
    }

    public record CaqhAddress(String street, String city, String state, String zip) {
    }

    public record CaqhBoardCert(String board, String status, String expires) {
    }

    public record CaqhMalpractice(String carrier, String policyNumber, String expires, String limit) {
    }

    public record CaqhEducation(String school, String degree, String year) {
    }

    public record CaqhWork(String employer, String title, String startDate, String endDate) {
    }

    /** A credential document CAQH reports as on file (verified; no file content is transferred). */
    public record CaqhDocument(String id, String type, String label, String fileName, String status, String expires,
                               String verifiedBy, String verifiedAt, Integer sizeKB, String coverageLimit) {
    }

    /** Provider profile as returned by CAQH ProView (dates are ISO strings). */
    public record CaqhProfile(
            String caqhId,
            String firstName,
            String lastName,
            String suffix,
            String specialty,
            String npi,
            String email,
            String phone,
            String license,
            String licenseState,
            String licenseExpires,
            String deaNumber,
            String deaExpires,
            CaqhBoardCert boardCert,
            String taxonomy,
            String gender,
            String dob,
            CaqhAddress address,
            List<CaqhEducation> educationHistory,
            List<CaqhWork> workHistory,
            CaqhMalpractice malpractice,
            Integer docCount,
            String attestedAt,
            List<CaqhDocument> documents,
            /* mock | real */
            String source) {

        public CaqhProfile withDocuments(List<CaqhDocument> docs, String src) {
            return new CaqhProfile(caqhId, firstName, lastName, suffix, specialty, npi, email, phone, license,
                    licenseState, licenseExpires, deaNumber, deaExpires, boardCert, taxonomy, gender, dob, address,
                    educationHistory, workHistory, malpractice, docCount, attestedAt, docs, src);
        }
    }

    /** API key is never returned; hasApiKey tells whether one is stored. */
    public record CaqhLookupConfigResponse(String mode, String apiUrl, boolean hasApiKey, String orgId,
                                           List<String> mockCaqhIds) {
    }

    public record CaqhLookupConfigRequest(
            @NotBlank(message = "Mode is required")
            @Pattern(regexp = "mock|real", message = "Mode must be mock or real")
            String mode,
            @Size(max = 255, message = "API URL must be at most 255 characters")
            @Pattern(regexp = "^$|^https://\\S+$", message = "API URL must start with https://")
            String apiUrl,
            /* null = keep the stored key, "" = clear it */
            @Size(max = 300, message = "API key must be at most 300 characters")
            String apiKey,
            @Size(max = 100, message = "Organization ID must be at most 100 characters")
            String orgId) {
    }

    public record CaqhLookupTestResponse(boolean ok, String mode, String message) {
    }

    public record CaqhImportRequest(
            @NotBlank(message = "CAQH ID is required")
            @Pattern(regexp = "^\\d{6,10}$", message = "CAQH ID must be 6-10 digits")
            String caqhId,
            /* optional: client / practice / location can be set later */
            Long clientId,
            Long practiceId,
            Long locationId,
            @Size(max = 200, message = "At most 200 characters") String caqhPassword,
            /* optional: the provider's CAQH ProView username (shown under Credentials) */
            @Size(max = 100, message = "At most 100 characters") String caqhUsername,
            /* the provider form completed after the CAQH lookup (all fields required); overrides the CAQH profile */
            @jakarta.validation.Valid com.zmartcredential.dto.provider.ProviderDtos.ProviderCreateRequest details,
            /* the provider's sign-in to this app */
            /* ignored: the provider's email is the username */
            String username,
            @NotBlank(message = "Password is required") String password) {
    }

    public record CaqhImportResponse(Long providerId, String providerName, int documentsImported) {
    }
}
