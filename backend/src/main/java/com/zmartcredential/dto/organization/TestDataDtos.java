package com.zmartcredential.dto.organization;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

/**
 * Test data generator and JSON export / import. Generator fields are optional (defaults: 15 providers,
 * varied 2-6 enrollments, 5 locations, 7 users, 20 tasks).
 */
public final class TestDataDtos {

    private TestDataDtos() {
    }

    public record TestDataRequest(
            @Min(value = 1, message = "1 to 50") @Max(value = 50, message = "1 to 50") Integer providers,
            @Min(value = 0, message = "0 to 10") @Max(value = 10, message = "0 to 10") Integer enrollmentsPerProvider,
            @Min(value = 0, message = "0 to 20") @Max(value = 20, message = "0 to 20") Integer locations,
            @Min(value = 0, message = "0 to 20") @Max(value = 20, message = "0 to 20") Integer users,
            @Min(value = 0, message = "0 to 100") @Max(value = 100, message = "0 to 100") Integer tasks) {
    }

    public record TestDataCounts(long providers, long enrollments, long locations, long users, long tasks,
                                 long clients, long practices) {
    }

    // ---------- JSON export / import ----------
    // Records reference each other by the "id" strings of the file (exported database ids or any unique string).

    public record DataBundle(String exportedAt, String version, String description,
                             @NotNull(message = "File has no data section") @Valid DataBundleData data) {
    }

    public record DataBundleData(
            String orgName,
            /* the organization's practices */
            @Size(max = 500, message = "At most 500 practices") List<@Valid BundlePractice> practices,
            /* older files: practices grouped under clients (read as plain practices; no clients are created) */
            @Size(max = 200, message = "At most 200 clients") List<@Valid BundleClient> clients,
            @Size(max = 1000, message = "At most 1000 locations") List<@Valid BundleLocation> locations,
            @NotNull(message = "File is missing data.providers")
            @Size(max = 2000, message = "At most 2000 providers") List<@Valid BundleProvider> providers,
            @Size(max = 20000, message = "At most 20000 enrollments") List<@Valid BundleEnrollment> enrollments,
            @Size(max = 5000, message = "At most 5000 tasks") List<@Valid BundleTask> tasks) {
    }

    public record BundleClient(@NotBlank String id, @NotBlank @Size(max = 200) String name,
                               List<@Valid BundlePractice> practices) {
    }

    public record BundlePractice(@NotBlank String id, @NotBlank @Size(max = 200) String name, @Size(max = 20) String taxId,
                                 @Size(max = 255) String address, @Size(max = 30) String phone, @Size(max = 255) String email) {
    }

    public record BundleLocation(@NotBlank String id, String practiceId, @NotBlank @Size(max = 200) String name,
                                 @Size(max = 200) String legalName, @Size(max = 10) String npi, @Size(max = 40) String locationType,
                                 @Size(max = 255) String address, @Size(max = 100) String city, @Size(max = 2) String state,
                                 @Size(max = 10) String zip, @Size(max = 30) String phone, BigDecimal lat, BigDecimal lng,
                                 Boolean active) {
    }

    public record BundleDocument(String status, LocalDate expires) {
    }

    public record BundleProvider(@NotBlank String id, @NotBlank @Size(max = 80) String firstName,
                                 @NotBlank @Size(max = 80) String lastName, @Size(max = 10) String suffix,
                                 @Size(max = 120) String specialty, String npi, @Size(max = 255) String email,
                                 @Size(max = 30) String phone, @Size(max = 40) String licenseNumber, String licenseState,
                                 LocalDate licenseExpires, @Size(max = 20) String deaNumber, LocalDate deaExpires,
                                 String caqhId, String status, LocalDate dateAdded, String clientId, String practiceId,
                                 String locationId, Map<String, BundleDocument> documents) {
    }

    public record BundleEnrollment(@NotBlank String providerId, @NotBlank String payerCode, String status,
                                   LocalDate submittedDate, LocalDate effectiveDate) {
    }

    public record BundleTask(@NotBlank @Size(max = 255) String title, @Size(max = 2000) String description, String status,
                             String priority, LocalDate dueDate, String providerId) {
    }

    /** removed = previous test data replaced by the import; skipped = rows that could not be imported. */
    public record DataImportResult(TestDataCounts removed, TestDataCounts created, TestDataCounts totals,
                                   List<String> skipped) {
    }

    /** testUserPassword is the shared password of the generated test logins (null when no users were generated). */
    public record TestDataResult(TestDataCounts created, TestDataCounts totals, String testUserPassword) {
    }
}
