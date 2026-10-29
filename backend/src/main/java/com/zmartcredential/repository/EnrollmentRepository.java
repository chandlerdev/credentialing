package com.zmartcredential.repository;

import com.zmartcredential.entity.Enrollment;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

public interface EnrollmentRepository extends JpaRepository<Enrollment, Long>, JpaSpecificationExecutor<Enrollment> {

    Optional<Enrollment> findByIdAndOrgId(Long id, Long orgId);

    List<Enrollment> findByOrgId(Long orgId);

    List<Enrollment> findByNextFollowUpDateLessThanEqual(java.time.LocalDate date);

    List<Enrollment> findByProviderId(Long providerId);

    List<Enrollment> findByOrgIdAndProviderId(Long orgId, Long providerId);

    // enrollments module
    boolean existsByPayerId(Long payerId);

    List<Enrollment> findByOrgIdAndPayerId(Long orgId, Long payerId);

    List<Enrollment> findByOrgIdAndStatus(Long orgId, String status);

    // providers module
    List<Enrollment> findByProviderIdIn(java.util.Collection<Long> providerIds);

    // organization module (test data)
    long countByOrgIdAndTestDataTrue(Long orgId);

    @org.springframework.data.jpa.repository.Modifying(flushAutomatically = true, clearAutomatically = true)
    @org.springframework.data.jpa.repository.Query("delete from Enrollment x where x.orgId = :orgId and x.testData = true")
    int orgDeleteTestData(@org.springframework.data.repository.query.Param("orgId") Long orgId);
}
