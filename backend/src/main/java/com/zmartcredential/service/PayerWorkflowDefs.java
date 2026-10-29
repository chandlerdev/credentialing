package com.zmartcredential.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zmartcredential.entity.Payer;
import jakarta.annotation.PostConstruct;
import java.io.InputStream;
import java.util.Locale;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/**
 * The payer credentialing workflows (credentialing-workflows.json): commercial (NCQA-aligned), Medicare (PECOS) and
 * Medicaid — their steps, checklists, details, documents and e-mail templates.
 */
@Component
public class PayerWorkflowDefs {

    private static final ObjectMapper JSON = new ObjectMapper();

    private JsonNode defs;

    @PostConstruct
    void load() throws Exception {
        try (InputStream in = new ClassPathResource("credentialing-workflows.json").getInputStream()) {
            defs = JSON.readTree(in);
        }
    }

    public JsonNode all() {
        return defs;
    }

    /** The follow-up cadence: a touch every this many days while the payer has the file. */
    public int cadenceDays() {
        return defs.path("followUpCadenceDays").asInt(14);
    }

    public JsonNode workflow(Payer p) {
        return defs.path("workflows").path(workflowKey(p));
    }

    /** Medicaid, Medicare fee-for-service (PECOS), else commercial. */
    public static String workflowKey(Payer p) {
        String c = p.getCategory() == null ? "" : p.getCategory().toLowerCase(Locale.ROOT);
        String pc = p.getPricingCategory();
        if (c.contains("medicaid") || "medicaid".equals(pc)) return "medicaid";
        if ((c.contains("medicare") || "medicare".equals(pc)) && !c.contains("advantage")) return "medicare";
        return "commercial";
    }

    public static int indexOf(JsonNode wf, String key) {
        JsonNode steps = wf.path("steps");
        for (int i = 0; i < steps.size(); i++) if (key.equals(steps.get(i).path("key").asText())) return i;
        return -1;
    }

    /** "Step 3/9: CAQH", "Approved · Contract" or "Active - maintaining". */
    public String statusLabel(Payer p, int step) {
        JsonNode wf = workflow(p);
        int total = wf.path("steps").size();
        if (total == 0) return null;
        int i = Math.max(0, Math.min(step, total - 1));
        JsonNode s = wf.path("steps").get(i);
        int approvedIdx = indexOf(wf, "approved");
        if ("maintain".equals(s.path("key").asText())) return "Active - maintaining";
        if (approvedIdx >= 0 && i > approvedIdx) return "Approved · " + s.path("short").asText();
        return "Step " + (i + 1) + "/" + total + ": " + s.path("short").asText();
    }
}
