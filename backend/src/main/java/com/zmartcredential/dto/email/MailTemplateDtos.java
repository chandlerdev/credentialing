package com.zmartcredential.dto.email;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/** Provider Link Templates / Enrollment Mail Templates. */
public final class MailTemplateDtos {

    private MailTemplateDtos() {
    }

    public record MailTemplateRequest(
            @NotBlank(message = "Choose the template type")
            @Pattern(regexp = "^(provider_link|enrollment_approved|document_request|payer_communication)$", message = "Unknown template type")
            String type,
            @NotBlank(message = "Template name is required") @Size(min = 2, max = 150, message = "2-150 characters")
            String name,
            @NotBlank(message = "Subject is required") @Size(max = 255, message = "At most 255 characters")
            String subject,
            @NotBlank(message = "Message is required") @Size(max = 10000, message = "At most 10,000 characters")
            String body) {
    }

    /** builtIn: provided with the app (can be used, not edited or deleted); inUse: the one emails are sent with. */
    public record MailTemplateItem(Long id, String type, String name, String subject, String body, boolean builtIn,
                                   boolean inUse, List<String> variables) {
    }

    public record MailTemplateList(String type, List<MailTemplateItem> templates, List<VariableInfo> variables) {
    }

    public record VariableInfo(String key, String label, boolean required) {
    }
}
