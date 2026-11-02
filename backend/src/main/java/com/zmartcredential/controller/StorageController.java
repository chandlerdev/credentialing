package com.zmartcredential.controller;

import com.zmartcredential.service.OneDriveService;
import com.zmartcredential.service.OneDriveService.SettingsRequest;
import com.zmartcredential.service.OneDriveService.SettingsView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

/** Super admin → Storage: keep uploaded documents in OneDrive / SharePoint (Microsoft Graph) instead of the server. */
@Tag(name = "Storage")
@RestController
@RequiredArgsConstructor
public class StorageController {

    private final OneDriveService service;

    @Operation(summary = "The OneDrive settings (the client secret is never returned) and the last upload's result")
    @GetMapping("/api/storage/settings")
    public SettingsView settings() {
        return service.settings();
    }

    @Operation(summary = "Save the OneDrive settings (turning it on checks them with Microsoft)")
    @PutMapping("/api/storage/settings")
    public SettingsView save(@RequestBody SettingsRequest req) {
        return service.save(req);
    }

    @Operation(summary = "Upload the sign-in certificate (.pfx with its password, or .pem with the private key); thumbprint is checked when given")
    @PostMapping(value = "/api/storage/certificate", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public SettingsView certificate(@RequestPart("file") MultipartFile file, @RequestParam(value = "password", required = false) String password,
                                    @RequestParam(value = "thumbprint", required = false) String thumbprint) throws java.io.IOException {
        return service.uploadCertificate(file.getOriginalFilename(), file.getBytes(), password, thumbprint);
    }

    @Operation(summary = "Check the saved settings with Microsoft again (sign-in, site, library, a test file)")
    @PostMapping("/api/storage/settings/test")
    public SettingsView test() {
        return service.test();
    }
}
