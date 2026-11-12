package com.zmartcredential.service;

import com.zmartcredential.dto.auth.PasswordResetDtos.ResetPasswordRequest;
import com.zmartcredential.entity.AppUser;
import com.zmartcredential.entity.PasswordReset;
import com.zmartcredential.exception.BadRequestException;
import com.zmartcredential.repository.AppUserRepository;
import com.zmartcredential.repository.PasswordResetRepository;
import com.zmartcredential.repository.RefreshTokenRepository;
import java.time.LocalDateTime;
import java.util.Locale;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Forgot password: a 6-digit code is emailed to the account's address (valid 10 minutes, 5 tries); a correct code
 * returns a reset token (valid 15 minutes, single use) that sets the new password. The request step never reveals
 * whether an email has an account.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PasswordResetService {

    public static final int CODE_MINUTES = 10;
    public static final int TOKEN_MINUTES = 15;
    public static final int MAX_ATTEMPTS = 5;
    public static final String SENT_MESSAGE =
            "If an account exists for this email, a 6-digit code has been sent. It is valid for " + CODE_MINUTES + " minutes.";

    private final AppUserRepository userRepository;
    private final PasswordResetRepository resetRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final MailService mailService;
    private final CryptoService cryptoService;
    private final PasswordEncoder passwordEncoder;

    @Transactional
    public String requestCode(String rawEmail) {
        String email = rawEmail.trim().toLowerCase(Locale.ROOT);
        // the super admin's password can't be changed (and the answer stays the same, so nothing is revealed)
        Optional<AppUser> found = userRepository.findByUsernameOrEmail(email, email)
                .filter(u -> email.equalsIgnoreCase(u.getEmail()) && !Boolean.TRUE.equals(u.getDisabled())
                        && !com.zmartcredential.security.Role.PLATFORM_ADMIN.code().equals(u.getRole()));
        if (found.isEmpty()) return SENT_MESSAGE;
        AppUser user = found.get();
        // a new code replaces any earlier one
        for (PasswordReset old : resetRepository.findByUserIdAndUsedAtIsNull(user.getId())) old.setUsedAt(LocalDateTime.now());
        String code = cryptoService.randomPin(6);
        PasswordReset r = new PasswordReset();
        r.setUserId(user.getId());
        r.setCodeHash(CryptoService.sha256Hex(user.getId() + ":" + code));
        r.setExpiresAt(LocalDateTime.now().plusMinutes(CODE_MINUTES));
        r.setAttempts(0);
        resetRepository.save(r);
        String body = "Hi " + (user.getFirstName() == null ? user.getDisplayName() : user.getFirstName()) + ",\n\n"
                + "Your ZmartCredential password reset code is: " + code + "\n\n"
                + "It is valid for " + CODE_MINUTES + " minutes. If you did not ask to reset your password, ignore this email.";
        // sent from the user's organization's own mail account
        MailService.Result mail = mailService.send(user.getOrgId(), user.getEmail(), "Your ZmartCredential password reset code", body);
        if (!mail.sent()) log.warn("Password reset code could not be emailed to {}: {}", user.getEmail(), mail.error());
        return SENT_MESSAGE;
    }

    @Transactional(noRollbackFor = BadRequestException.class)
    public String verifyCode(String rawEmail, String code) {
        String email = rawEmail.trim().toLowerCase(Locale.ROOT);
        AppUser user = userRepository.findByUsernameOrEmail(email, email)
                .filter(u -> email.equalsIgnoreCase(u.getEmail()))
                .orElseThrow(() -> new BadRequestException("The code is invalid or has expired"));
        PasswordReset r = resetRepository.findFirstByUserIdAndUsedAtIsNullOrderByCreatedAtDesc(user.getId())
                .orElseThrow(() -> new BadRequestException("The code is invalid or has expired"));
        if (r.getExpiresAt().isBefore(LocalDateTime.now())) {
            r.setUsedAt(LocalDateTime.now());
            throw new BadRequestException("The code has expired. Request a new one.");
        }
        if (r.getAttempts() >= MAX_ATTEMPTS) {
            r.setUsedAt(LocalDateTime.now());
            throw new BadRequestException("Too many wrong codes. Request a new one.");
        }
        if (!CryptoService.sha256Hex(user.getId() + ":" + code.trim()).equals(r.getCodeHash())) {
            r.setAttempts(r.getAttempts() + 1);
            int left = MAX_ATTEMPTS - r.getAttempts();
            throw new BadRequestException(left > 0 ? "Incorrect code. " + left + " attempt(s) left." : "Too many wrong codes. Request a new one.");
        }
        String token = cryptoService.randomToken(32);
        r.setResetTokenHash(CryptoService.sha256Hex(token));
        r.setTokenExpiresAt(LocalDateTime.now().plusMinutes(TOKEN_MINUTES));
        return token;
    }

    @Transactional
    public void resetPassword(ResetPasswordRequest req) {
        String problem = passwordProblem(req.password());
        if (problem != null) throw new BadRequestException(problem);
        if (!req.password().equals(req.confirmPassword())) throw new BadRequestException("The passwords do not match");
        PasswordReset r = resetRepository.findByResetTokenHash(CryptoService.sha256Hex(req.resetToken()))
                .filter(x -> x.getUsedAt() == null && x.getTokenExpiresAt() != null && x.getTokenExpiresAt().isAfter(LocalDateTime.now()))
                .orElseThrow(() -> new BadRequestException("This reset session has expired. Start again."));
        AppUser user = userRepository.findById(r.getUserId())
                .filter(u -> !com.zmartcredential.security.Role.PLATFORM_ADMIN.code().equals(u.getRole()))
                .orElseThrow(() -> new BadRequestException("This reset session has expired. Start again."));
        user.setPasswordHash(passwordEncoder.encode(req.password()));
        userRepository.save(user);
        r.setUsedAt(LocalDateTime.now());
        // sign out every session of this account
        refreshTokenRepository.revokeAllForUser(user.getId(), LocalDateTime.now());
    }

    /** Strict password rule shared with the sign-in page; null when the password is acceptable. */
    public static String passwordProblem(String p) {
        if (p == null || p.isEmpty() || p.isBlank()) return "Enter a new password";
        if (p.chars().anyMatch(Character::isWhitespace)) return "The password cannot contain spaces";
        if (p.length() < 8) return "Use at least 8 characters";
        if (!p.matches(".*[A-Z].*")) return "Add an uppercase letter";
        if (!p.matches(".*[a-z].*")) return "Add a lowercase letter";
        if (!p.matches(".*[0-9].*")) return "Add a number";
        if (!p.matches(".*[^A-Za-z0-9].*")) return "Add a special character (e.g. @ # $ !)";
        return null;
    }
}
