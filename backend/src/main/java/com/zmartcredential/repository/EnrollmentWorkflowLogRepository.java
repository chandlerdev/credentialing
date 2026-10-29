package com.zmartcredential.repository;

import com.zmartcredential.entity.EnrollmentWorkflowLog;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EnrollmentWorkflowLogRepository extends JpaRepository<EnrollmentWorkflowLog, Long> {

    List<EnrollmentWorkflowLog> findByEnrollmentIdOrderByIdDesc(Long enrollmentId);

    List<EnrollmentWorkflowLog> findByEnrollmentIdIn(Collection<Long> enrollmentIds);

    boolean existsByMessageId(String messageId);

    List<EnrollmentWorkflowLog> findByMessageIdIn(Collection<String> messageIds);

    Optional<EnrollmentWorkflowLog> findFirstByLogTypeAndEmailToIgnoreCaseAndEmailSubjectIgnoreCaseOrderByIdDesc(String logType, String emailTo, String emailSubject);
}
