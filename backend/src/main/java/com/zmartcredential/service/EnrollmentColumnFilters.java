package com.zmartcredential.service;

import com.zmartcredential.dto.enrollment.EnrollmentResponse;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.Comparator;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;

/**
 * Enrollments list: the filter box above each column and its ↑ / ↓ sort (same rules as the provider's My Enrollments).
 * Text boxes match what the column shows (dates also as MM/DD/YYYY); Status, Follow-ups and Acknowledgement are choices.
 */
public record EnrollmentColumnFilters(String provider, String payer, String submitted, String approved, String tat,
                                      String last, String next, String followUps, String notes, String ack) {

    private static final DateTimeFormatter LONG = DateTimeFormatter.ofPattern("MMM d, yyyy", Locale.US);
    private static final DateTimeFormatter SHORT = DateTimeFormatter.ofPattern("MM/dd/yyyy", Locale.US);
    private static final Map<String, String> STATUS_LABELS = Map.of("draft", "Pending", "in_progress", "In Progress",
            "submitted", "Submitted", "approved", "Approved", "needs_attention", "Needs Attention", "on_hold", "On Hold",
            "terminated", "Terminated");

    public boolean active() {
        return has(provider) || has(payer) || has(submitted) || has(approved) || has(tat) || has(last) || has(next)
                || has(followUps) || has(notes) || has(ack);
    }

    public boolean matches(EnrollmentResponse e, LocalDate today) {
        return contains(e.providerName(), provider) && contains(e.payerName(), payer)
                && contains(date(e.submittedDate()), submitted) && contains(date(e.effectiveDate()), approved)
                && contains(e.tatDays() == null ? "" : e.tatDays() + "d " + e.tatDays(), tat)
                && contains(date(e.followUpDate()), last) && contains(nextText(e, today), next)
                && contains(e.notes(), notes) && followUpsMatch(e) && ackMatch(e);
    }

    private boolean followUpsMatch(EnrollmentResponse e) {
        if (!has(followUps)) return true;
        return switch (followUps.trim()) {
            case "calls" -> e.callCount() > 0;
            case "emails" -> e.emailCount() > 0;
            case "none" -> e.callCount() + e.emailCount() == 0;
            default -> true;
        };
    }

    private boolean ackMatch(EnrollmentResponse e) {
        if (!has(ack)) return true;
        return switch (ack.trim()) {
            case "uploaded" -> e.acknowledgementFileId() != null;
            case "missing" -> e.acknowledgementFileId() == null;
            default -> true;
        };
    }

    private static String nextText(EnrollmentResponse e, LocalDate today) {
        LocalDate d = e.nextFollowUpDate();
        if (d == null) return "";
        String s = date(d);
        if (d.isBefore(today) && !"approved".equals(e.status())) s += " overdue";
        else if (d.equals(today)) s += " today";
        return s;
    }

    /**
     * The sort for a column key (provider, payer, status, submitted, approved, tat, last, next, followups, ack), or
     * null when the key is not a column. Empty values always sort last.
     */
    @SuppressWarnings({"unchecked", "rawtypes"})
    public static Comparator<EnrollmentResponse> comparator(String key, boolean desc) {
        Function<EnrollmentResponse, Comparable> f = switch (key) {
            case "provider" -> e -> lower(e.providerName());
            case "payer" -> e -> lower(e.payerName());
            case "status" -> e -> STATUS_LABELS.getOrDefault(e.status(), e.status());
            case "submitted" -> EnrollmentResponse::submittedDate;
            case "approved" -> EnrollmentResponse::effectiveDate;
            case "tat" -> EnrollmentResponse::tatDays;
            case "last" -> EnrollmentResponse::followUpDate;
            case "next" -> EnrollmentResponse::nextFollowUpDate;
            case "followups" -> e -> e.callCount() + e.emailCount();
            case "ack" -> e -> e.acknowledgementFileId() == null ? 0 : 1;
            default -> null;
        };
        if (f == null) return null;
        Comparator<Comparable> order = desc ? Comparator.reverseOrder() : Comparator.naturalOrder();
        Comparator<EnrollmentResponse> c = Comparator.comparing(f, Comparator.nullsLast(order));
        return c.thenComparing(EnrollmentResponse::id, Comparator.reverseOrder());
    }

    private static boolean has(String s) {
        return s != null && !s.isBlank();
    }

    private static boolean contains(String value, String q) {
        if (!has(q)) return true;
        return value != null && value.toLowerCase(Locale.ROOT).contains(q.trim().toLowerCase(Locale.ROOT));
    }

    private static String date(LocalDate d) {
        return d == null ? "" : d.format(LONG) + " " + d.format(SHORT);
    }

    private static String lower(String s) {
        return s == null || s.isBlank() ? null : s.toLowerCase(Locale.ROOT);
    }
}
