# Backend

Java 21, Spring Boot 4.1.2, Spring Security, JPA, MySQL 8.4 LTS를 사용합니다.

```sh
./mvnw verify
```

통합 테스트는 H2의 MySQL 모드로 별도 실행합니다. 운영은 MySQL을 사용하며 Flyway가 스키마를 관리합니다. 일정은 날짜 인덱스가 있는 별도 테이블, 시간표·WOL 설정은 잠금으로 전체 변경의 원자성을 보장하는 JPA 문서로 저장합니다. 개인 서비스의 소규모 설정에 불필요한 조인과 테이블을 늘리지 않습니다.

운영 비밀정보는 `/etc/myworkspace/application.env`에 주입합니다. 필수 값은 `DB_URL`, `DB_USER`, `DB_PASSWORD`, `DB_MIGRATION_USER`, `DB_MIGRATION_PASSWORD`, `APP_PASSWORD_HASH`입니다. API 계약은 `FE/src/api/client.ts`, 실행과 복구 절차는 [운영 문서](../docs/backend-operations.md)를 참고하세요.

- 인증: `/api/auth/csrf`, `/session`, `/login`, `/logout`
- 일정: `/api/calendar/calendars`, `/events`, `/icloud/status`, `/holidays/status`, `/api/today`
- 시간표: `/api/timetable`
- 모니터링: `/api/server/status`, `/history?range=1m|15m|1D|1W|1M`
- WOL: `/api/wol/devices`, `/{id}/mac`, `/{id}/wake`, `/{id}/boot`
- 이전 시안의 선택 데이터 가져오기: `/api/import/legacy`

쓰기 API는 자동 입장한 내부망에서도 CSRF 토큰이 필요합니다. iCloud는 미연결 상태이며 서버에 저장한 일정을 iCloud에 전송하지 않습니다. WOL의 `sentAt`은 전송 완료 시각이며 실제 PC의 부팅 확인은 `unknown`으로 반환합니다.
