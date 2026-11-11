package com.zmartcredential.dto.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.LocalDateTime;
import java.util.List;

/** Super admin: dashboard and the admins (organization accounts) created through "Create Admin". */
public final class PlatformDtos {

    private PlatformDtos() {
    }

    public record AdminSummary(Long userId, String name, String email, String phone, Long orgId, String orgName,
                               String orgStatus, String planName, long providerCount, long userCount,
                               boolean disabled, LocalDateTime createdAt) {
    }

    public record PlatformSummary(long organizations, long admins, long users, long providers, long userRoles,
                                  List<AdminSummary> recentAdmins) {
    }

    /** Create Admin → Edit: everything entered when the admin was created (the card's brand / last 4 only). */
    public record AdminDetail(Long userId, Long orgId,
                              String orgName, String orgType, String taxId, String website, String address,
                              String city, String state, String zip,
                              String firstName, String lastName, String email, String phone,
                              String packageId, Integer estimatedProviders,
                              String cardBrand, String cardLast4, String cardExp, String billingName, String billingZip,
                              String orgStatus, boolean disabled, LocalDateTime createdAt) {
    }

    /** Same rules as Create Admin; the password and the card are changed only when given. */
    public record AdminUpdateRequest(
            @NotNull @Valid OrgSignupRequest.Org org,
            @NotNull @Valid AdminAccount admin,
            @NotNull @Valid OrgSignupRequest.Plan plan,
            @NotNull @Valid Payment paymentMethod) {

        public record AdminAccount(
                @NotBlank(message = "First name is required") @Size(max = 100) String firstName,
                @NotBlank(message = "Last name is required") @Size(max = 100) String lastName,
                @NotBlank(message = "Email is required") @Email(message = "Valid email required") @Size(max = 255) String email,
                @NotBlank(message = "Phone is required")
                @Pattern(regexp = com.zmartcredential.util.PhoneNumber.OPTIONAL_PATTERN, message = com.zmartcredential.util.PhoneNumber.MESSAGE) String phone,
                /* blank keeps the current password */
                @Pattern(regexp = "^$|.{8,100}", message = "At least 8 characters") String password) {
        }

        /** brand + last4 only when a new card was entered (blank keeps the card on file). */
        public record Payment(
                @Size(max = 30) String brand,
                @Pattern(regexp = "^$|[0-9]{4}", message = "Invalid card") String last4,
                @NotBlank(message = "Expiry is required") @Pattern(regexp = "(0[1-9]|1[0-2])/[0-9]{2}", message = "MM/YY format (month 01-12)") String exp,
                @NotBlank(message = "Name on card is required") @Size(max = 120) String billingName,
                @NotBlank(message = "Billing ZIP is required") @Pattern(regexp = "[0-9]{5}", message = "5 digits") String billingZip) {
        }
    }
}
