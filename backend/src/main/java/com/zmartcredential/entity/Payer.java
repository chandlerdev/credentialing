package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

@Entity
@Table(name = "payer")
@Getter
@Setter
@NoArgsConstructor
/** Deleting marks the row deleted (is_deleted = 1); deleted rows are left out of every query. */
@org.hibernate.annotations.SoftDelete(columnName = "is_deleted")
public class Payer {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String code;

    private String name;

    private String fullName;

    private String category;

    private String payerType;

    private String color = "#64748b";

    private String appForm;

    private String integration = "portal";

    private String apiSupport = "portal";

    /** caqh_roster | availity | pecos | state_portal | direct_api | portal_only */
    private String submissionMethod = "portal_only";

    private Boolean apiAvailable = false;

    private String apiVendor;

    private String apiDocsUrl;

    private String submissionNotes;

    private Boolean caqhParticipating = false;

    private String portalUrl;

    private Integer avgTatDays;

    private String pricingCategory;

    private BigDecimal pricingMult = new BigDecimal("1.00");

    private Integer recredCycleMonths = 24;

    private Integer sortOrder = 0;

    private Boolean active = true;

    /** Optional card image (a data: URL), set by the super admin; the name's letters are shown without it. */
    @Column(columnDefinition = "MEDIUMTEXT")
    private String logo;

    /** Whether the payer has a provider portal. */
    private Boolean portalAvailable = true;

    /** "CAQH Update" (free text). */
    private String caqhUpdate;

    /** the payer's support mailbox and line (the Email / Call buttons of the payer cards) */
    private String supportEmail;

    private String supportPhone;

    /** API access: key and token, encrypted (never sent back to the browser). */
    @Column(columnDefinition = "TEXT")
    private String apiKeyEnc;

    @Column(columnDefinition = "TEXT")
    private String apiTokenEnc;

    /** The organization whose admin added this payer (null = added by the super admin). */
    private Long addedByOrgId;

    @CreationTimestamp
    @Column(updatable = false)
    private LocalDateTime createdAt;

    @UpdateTimestamp
    private LocalDateTime updatedAt;

    /** 0 while the row is live; the row's id once deleted, so its unique values can be used again. */
    private Long delToken = 0L;
}
