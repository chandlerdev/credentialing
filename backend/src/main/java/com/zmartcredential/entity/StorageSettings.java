package com.zmartcredential.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

/** Where uploaded documents are stored (super admin → Storage; one row, id 1): the server's disk or OneDrive / SharePoint. */
@Entity
@Table(name = "storage_settings")
@Getter
@Setter
@NoArgsConstructor
public class StorageSettings {

    public static final long ID = 1L;

    @Id
    private Long id;

    private Boolean enabled = false;

    private String tenantId;

    private String clientId;

    private String clientSecretEnc;

    private LocalDate secretExpires;

    /** e.g. https://contoso.sharepoint.com/sites/Credentialing */
    private String siteUrl;

    /** the document library, e.g. Documents */
    private String library;

    /** the folder inside the library, e.g. ZmartCredential/Testing */
    private String folder;

    /** resolved from the site URL and library when saved */
    private String siteId;

    private String driveId;

    private String folderUrl;

    private LocalDateTime lastUploadAt;

    private String lastUploadName;

    private Boolean lastUploadOk;

    private String lastUploadError;

    /** secret | certificate */
    private String authMethod;

    /** the certificate's private key (PKCS#8, encrypted) and the certificate (DER, base64) */
    private String certKeyEnc;

    private String certDer;

    private String certThumbprint;

    private String certSubject;

    private LocalDate certExpires;

    private String updatedBy;

    @UpdateTimestamp
    private LocalDateTime updatedAt;
}
