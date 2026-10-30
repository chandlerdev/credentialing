package com.zmartcredential.controller;

import com.zmartcredential.service.TwilioCallingService;
import com.zmartcredential.service.TwilioCallingService.SessionView;
import com.zmartcredential.service.TwilioCallingService.SettingsRequest;
import com.zmartcredential.service.TwilioCallingService.SettingsView;
import com.zmartcredential.service.TwilioCallingService.TokenView;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/** Browser calling through Twilio: the platform settings (super admin), the browser token, the call result and Twilio's webhooks. */
@Tag(name = "Calling")
@RestController
@RequiredArgsConstructor
public class CallingController {

    private final TwilioCallingService service;

    @Operation(summary = "Super admin → Communication: the platform's Twilio account (secrets are never returned)")
    @GetMapping("/api/calling/settings")
    public SettingsView settings() {
        return service.settings();
    }

    @Operation(summary = "Save the Twilio account (checked with Twilio; creates the calling app)")
    @PutMapping("/api/calling/settings")
    public SettingsView save(@RequestBody SettingsRequest req) {
        return service.save(req);
    }

    @Operation(summary = "Whether browser calling is on (token=true: an access token for the Twilio Voice SDK)")
    @GetMapping("/api/calling/token")
    public TokenView token(@RequestParam(defaultValue = "false") boolean issue) {
        return service.token(issue);
    }

    @Operation(summary = "The payer's answer to a browser call (after hang-up)")
    @GetMapping("/api/calling/sessions/{callSid}")
    public SessionView session(@PathVariable String callSid) {
        return service.session(callSid);
    }

    @PostMapping(value = "/api/public/twilio/voice", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE, produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> voice(@RequestParam Map<String, String> params, @RequestHeader(value = "X-Twilio-Signature", required = false) String signature) {
        String twiml = service.voice(params, signature);
        return twiml == null ? ResponseEntity.status(HttpStatus.FORBIDDEN).build() : ResponseEntity.ok().contentType(MediaType.APPLICATION_XML).body(twiml);
    }

    @PostMapping(value = "/api/public/twilio/dial-result", consumes = MediaType.APPLICATION_FORM_URLENCODED_VALUE, produces = MediaType.APPLICATION_XML_VALUE)
    public ResponseEntity<String> dialResult(@RequestParam Map<String, String> params, @RequestHeader(value = "X-Twilio-Signature", required = false) String signature) {
        String twiml = service.dialResult(params, signature);
        return twiml == null ? ResponseEntity.status(HttpStatus.FORBIDDEN).build() : ResponseEntity.ok().contentType(MediaType.APPLICATION_XML).body(twiml);
    }
}
