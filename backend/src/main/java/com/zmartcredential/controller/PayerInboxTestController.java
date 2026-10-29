package com.zmartcredential.controller;

import com.zmartcredential.security.AuthContext;
import com.zmartcredential.service.PayerInboxService;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/**
 * Testing only (app.mail.inbox.test-ingest=true): feeds a raw email to the payer-reply matching, as if read from the
 * mailbox, and runs the follow-up reminders now.
 */
@RestController
@RequiredArgsConstructor
@ConditionalOnProperty(name = "app.mail.inbox.test-ingest", havingValue = "true")
public class PayerInboxTestController {

    private final PayerInboxService inbox;
    private final AuthContext authContext;
    private final com.zmartcredential.service.FollowUpDueJob followUpDueJob;

    @PostMapping("/api/payer-workflows/test/follow-up-due")
    public Map<String, Object> followUpDue() {
        authContext.requireStaff();
        return Map.of("notified", followUpDueJob.sendDue(java.time.LocalDate.now()));
    }

    @PostMapping("/api/payer-workflows/inbox/test-ingest")
    public Map<String, Object> ingest(@RequestBody String raw) throws Exception {
        authContext.requireStaff();
        return inbox.ingestRaw(raw).<Map<String, Object>>map(l -> Map.of("logged", true, "enrollmentId", l.getEnrollmentId()))
                .orElse(Map.of("logged", false));
    }
}
