package kr.myworkspace.common.document;

import jakarta.persistence.LockModeType;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface DocumentRepository extends JpaRepository<AppDocument, String> {
  @Lock(LockModeType.PESSIMISTIC_WRITE)
  @Query("select d from AppDocument d where d.id = :id")
  Optional<AppDocument> locked(@Param("id") String id);
}
