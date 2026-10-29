package com.zmartcredential.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "email_template")
@Getter
@Setter
@NoArgsConstructor
public class EmailTemplate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private Long orgId;

    private String type;

    private String name;

    private String subject;

    private String body;

    /** Deleted (kept, left out of the lists). Also marks a built-in template an organization deleted. */
    @Column(name = "is_deleted")
    private Boolean deleted = false;

    /** An organization's own copy of the built-in template it edited or deleted (hides the built-in for it). */
    private Long baseTemplateId;

    /** A built-in template's key (payer communication: the workflow step suggests it); kept on an organization's copy. */
    private String code;
}
