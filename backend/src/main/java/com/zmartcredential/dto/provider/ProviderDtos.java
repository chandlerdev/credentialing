package com.zmartcredential.dto.provider;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

/** Request/response records of the providers module. */
public final class ProviderDtos {

    private ProviderDtos() {
    }

    public static final String STATUS_REGEX = "draft|in_progress|active|on_hold|terminated";

    /** Required-document progress: approved of required (non-N/A) docs, and critical docs missing/expired. */
    public record ProviderDocProgress(int approved, int required, int missingCritical) {
    }

    public record ProviderEnrollmentCounts(int total, int approved) {
    }

    public record ProviderListItem(
            Long id, String firstName, String lastName, String suffix, String specialty, String status,
            String email, String phone, String npi, String caqhId,
            Long clientId, Long practiceId, String practiceName, Long locationId, String locationName,
            Boolean telemed, String source, LocalDate dateAdded,
            ProviderDocProgress documents, ProviderEnrollmentCounts enrollments) {
    }

    public record ProviderLite(Long id, String name, String npi, String specialty, String status, Long locationId) {
    }

    public record ProviderDetail(
            Long id, String firstName, String lastName, String suffix, String specialty,
            String practitionerType, String taxonomyCode, String gender, String ethnicity, LocalDate dateOfBirth,
            String npi, String email, String phone,
            String licenseNumber, String licenseState, LocalDate licenseExpires,
            String deaNumber, LocalDate deaExpires, String boardCert, String malpracticeCarrier,
            String caqhId, String caqhUsername, LocalDate caqhLastAttested, LocalDateTime caqhLastSynced,
            String caqhAttestationStatus,
            Long clientId, String clientName, Long practiceId, String practiceName,
            Long locationId, String locationName,
            String status, Boolean telemed, String source, LocalDate dateAdded, Boolean selfSignup,
            LocalDateTime createdAt, LocalDateTime updatedAt,
            ProviderDocProgress documentProgress, ProviderEnrollmentCounts enrollments,
            List<ProviderDocumentDtos.ProviderDocumentRow> documents,
            /* Credentials block: whether a CAQH password is stored (never the password itself), PECOS access */
            boolean hasCaqhPassword, Boolean pecosAccessGranted, String pecosUsername,
            /* the provider has a sign-in (username = their email) */
            boolean hasLogin,
            /* more provider details (group, IDs, home / practice / billing) */
            ProviderExtraDtos.ProviderExtraView extra) {
    }

    /** Edit Provider → Change Password: the provider's sign-in password (8-100 characters). */
    public record ProviderPasswordRequest(
            @jakarta.validation.constraints.NotBlank(message = "Enter the new password")
            @jakarta.validation.constraints.Size(min = 8, max = 100, message = "8-100 characters")
            String password) {
    }

    /** created: the provider had no sign-in, so one was created (username = their email). */
    public record ProviderPasswordResult(boolean created, String username) {
    }

    /** Manual add (ManualAddModal) - also used by API clients for a full create. */
    public record ProviderCreateRequest(
            @NotBlank(message = "First name is required") @Size(max = 80, message = "At most 80 characters") String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 80, message = "At most 80 characters") String lastName,
            @Size(max = 10, message = "At most 10 characters") String suffix,
            @Size(max = 120, message = "At most 120 characters") String specialty,
            @Pattern(regexp = "^$|^\\d{10}$", message = "NPI must be exactly 10 digits") String npi,
            @Email(message = "Enter a valid email address") @Size(max = 255) String email,
            @Size(max = 30, message = "At most 30 characters") String phone,
            @Size(max = 40, message = "At most 40 characters") String licenseNumber,
            @Pattern(regexp = "^$|^[A-Za-z]{2}$", message = "Use the 2-letter state code") String licenseState,
            LocalDate licenseExpires,
            @Size(max = 60) String practitionerType,
            @Size(max = 20) String taxonomyCode,
            @Size(max = 20) String gender,
            LocalDate dateOfBirth,
            @Size(max = 20, message = "At most 20 characters") String deaNumber,
            LocalDate deaExpires,
            @Size(max = 200) String boardCert,
            @Size(max = 200) String malpracticeCarrier,
            @Pattern(regexp = "^$|^\\d{1,10}$", message = "CAQH ID must contain digits only") String caqhId,
            Long clientId, Long practiceId, Long locationId,
            Boolean telemed,
            @Size(max = 100, message = "At most 100 characters") String caqhUsername,
            @Size(max = 200, message = "At most 200 characters") String caqhPassword,
            Boolean pecosAccessGranted,
            @Size(max = 100, message = "At most 100 characters") String pecosUsername,
            /* the provider's status (defaults to draft) */
            @Pattern(regexp = "^$|" + STATUS_REGEX, message = "Status must be draft, in_progress, active, on_hold or terminated") String status,
            /* more provider details (optional block) */
            @jakarta.validation.Valid ProviderExtraDtos.ProviderExtraInput extra) {
    }

    /**
     * ProviderEditModal. Core fields are replaced (null clears them); the extended fields
     * (licenseExpires, taxonomyCode, deaNumber, deaExpires, boardCert, malpracticeCarrier, practitionerType,
     * gender, ethnicity, dateOfBirth, telemed) are only changed when non-null.
     */
    public record ProviderUpdateRequest(
            @NotBlank(message = "First name is required") @Size(max = 80, message = "At most 80 characters") String firstName,
            @NotBlank(message = "Last name is required") @Size(max = 80, message = "At most 80 characters") String lastName,
            @Size(max = 10, message = "At most 10 characters") String suffix,
            @Pattern(regexp = "^$|^\\d{10}$", message = "10 digits required") String npi,
            @Pattern(regexp = "^$|^\\d{1,10}$", message = "CAQH ID must contain digits only") String caqhId,
            @Size(max = 120) String specialty,
            @Email(message = "Enter a valid email address") @Size(max = 255) String email,
            @Size(max = 30, message = "At most 30 characters") String phone,
            @Size(max = 40, message = "At most 40 characters") String licenseNumber,
            @Pattern(regexp = "^$|^[A-Za-z]{2}$", message = "Use the 2-letter state code") String licenseState,
            @NotBlank(message = "Status is required")
            @Pattern(regexp = STATUS_REGEX, message = "Status must be draft, in_progress, active, on_hold or terminated") String status,
            Long clientId, Long practiceId, Long locationId,
            LocalDate licenseExpires,
            @Size(max = 20) String taxonomyCode,
            @Size(max = 20) String deaNumber,
            LocalDate deaExpires,
            @Size(max = 200) String boardCert,
            @Size(max = 200) String malpracticeCarrier,
            @Size(max = 60) String practitionerType,
            @Size(max = 20) String gender,
            @Size(max = 60) String ethnicity,
            LocalDate dateOfBirth,
            Boolean telemed,
            /* CAQH ProView username (Credentials block); changed only when non-null */
            @Size(max = 100, message = "At most 100 characters") String caqhUsername,
            /* blank or null keeps the stored password */
            @Size(max = 200, message = "At most 200 characters") String caqhPassword,
            Boolean pecosAccessGranted,
            @Size(max = 100, message = "At most 100 characters") String pecosUsername,
            /* more provider details (null keeps them) */
            @jakarta.validation.Valid ProviderExtraDtos.ProviderExtraInput extra) {
    }

    public record ProviderStatusRequest(
            @NotBlank(message = "Status is required")
            @Pattern(regexp = STATUS_REGEX, message = "Status must be draft, in_progress, active, on_hold or terminated") String status) {
    }

    /** locationId null = unassign. */
    public record ProviderAssignmentRequest(Long locationId) {
    }

    public record ProviderBulkAssignRequest(
            @NotEmpty(message = "Select at least one provider") List<@NotNull Long> providerIds,
            Long locationId) {
    }

    public record ProviderBulkAssignResult(int updated, Long locationId, String locationName) {
    }

    public record ProviderLocationCount(Long locationId, String locationName, String legalName, Long practiceId,
                                        long count) {
    }

    public record ProviderAssignmentSummary(long total, long assigned, long unassigned, long locations,
                                            List<ProviderLocationCount> byLocation) {
    }

    // ---------- CAQH import ----------

    /** One provider parsed by the frontend from a CAQH export (single) or roster (bulk) CSV. Dates are ISO strings. */
    public record ProviderImportRow(
            Integer rowIndex,
            String caqhId, String npi, String firstName, String middleName, String lastName, String suffix,
            String specialty, String taxonomy, String dob, String gender, String email, String phone,
            String license, String licenseState, String licenseExpiration, String licenseIssued, String licenseStatus,
            String dea, String deaExpiration,
            String malpracticeCarrier, String malpracticeExpiration,
            String boardCert, String boardCertExpiration,
            String lastAttestation, String attestationStatus, String profileStatus, String authStatus) {
    }

    public record ProviderImportRequest(
            Long practiceId, Long locationId,
            @NotEmpty(message = "No providers to import") @Size(max = 1000, message = "At most 1000 providers per import")
            List<@Valid @NotNull ProviderImportRow> providers) {
    }

    public record ProviderImportCreated(Long id, String name) {
    }

    public record ProviderImportSkipped(int rowIndex, String name, String reason) {
    }

    public record ProviderImportResult(List<ProviderImportCreated> created, List<ProviderImportSkipped> skipped) {
    }

    // ---------- Provider self-service ----------

    public record MyProviderUpdateRequest(
            @Size(max = 30, message = "At most 30 characters") String phone,
            @Email(message = "Enter a valid email address") @Size(max = 255) String email,
            @Size(max = 120) String specialty,
            @Size(max = 40, message = "At most 40 characters") String licenseNumber,
            @Pattern(regexp = "^$|^[A-Za-z]{2}$", message = "Use the 2-letter state code") String licenseState,
            LocalDate licenseExpires) {
    }

    public record MyEnrollment(Long id, Long payerId, String payerName, String payerColor, String status,
                               String applicationType, LocalDate submittedDate, LocalDate effectiveDate,
                               Integer tatDays) {
    }
}
