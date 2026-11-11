package com.zmartcredential.dto.organization;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Request/response records for the Organization -> Client -> Practice -> Location tree. */
public final class OrgStructureDtos {

    private OrgStructureDtos() {
    }

    /** A practice of the organization. */
    public record PracticeRequest(
            @NotBlank(message = "Practice name is required") @Size(min = 2, max = 200, message = "2-200 characters")
            @Pattern(regexp = ".*[A-Za-z].*", message = "Practice name must contain letters") String name,
            @Pattern(regexp = "^$|(?=.*[A-Za-z0-9])[A-Za-z0-9-]{5,20}", message = "Tax ID must be 5-20 letters or digits") String taxId,
            @Size(max = 255, message = "Max 255 characters")
            @Pattern(regexp = "^$|[\\p{L}0-9 #,.:'/&()-]*\\p{L}[\\p{L}0-9 #,.:'/&()-]*", message = "Address may contain letters, digits and # , . : - / ' & ( ) and must include a street name") String address,
            @Pattern(regexp = com.zmartcredential.util.PhoneNumber.OPTIONAL_PATTERN, message = com.zmartcredential.util.PhoneNumber.MESSAGE) String phone,
            @Email(message = "Valid email required") @Size(max = 255) String email) {
    }

    public record PracticeResponse(Long id, String name, String taxId,
                                   String address, String phone, String email, int locationCount,
                                   long providerCount) {
    }

    /** Result of deleting a practice / location. */
    public record DeleteResult(boolean deleted, int unassignedProviders, int detachedLocations) {
    }

    public record PracticeNode(Long id, String name, String taxId, String address, String phone,
                               String email, int locationCount, long providerCount,
                               List<LocationResponse> locations) {
    }

    public record Totals(int practices, int locations, long providers,
                         long unassignedProviders) {
    }

    public record OrgTreeResponse(OrganizationResponse organization, List<PracticeNode> practices,
                                  List<LocationResponse> unassignedLocations, Totals totals) {
    }

    public record InviteCodeResponse(String inviteCode) {
    }
}
