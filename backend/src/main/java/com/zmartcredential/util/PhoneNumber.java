package com.zmartcredential.util;

/**
 * Phone / mobile numbers everywhere: the country code +1 (the only one the screens offer for now) and exactly
 * 10 digits, stored as "+1 2025550123". Older values saved with +91 or without a code are still accepted.
 */
public final class PhoneNumber {

    private PhoneNumber() {
    }

    /** For @Pattern on optional phone fields (blank allowed). */
    public static final String OPTIONAL_PATTERN = "^$|(\\+(1|91) ?)?[0-9]{10}";

    public static final String MESSAGE = "Phone must be 10 digits";

    public static boolean isValid(String v) {
        return v != null && v.trim().matches("(\\+(1|91) ?)?[0-9]{10}");
    }
}
