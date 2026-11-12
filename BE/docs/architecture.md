# 백엔드 구조

이 백엔드는 **기능별 패키지를 중심으로 한 계층형 구조**를 사용합니다. 기능을 먼저 찾은 뒤 클래스 이름으로 역할을 구분합니다. 캘린더 수정은 `calendar`, 로그인 수정은 `auth`에서 시작합니다.

개인용 단일 Spring Boot 앱이므로 한 모듈을 유지합니다. 기능마다 별도 빌드 모듈이나 인터페이스·구현체를 만들지 않고, 실제로 필요한 Controller·Service·Repository·연동 클라이언트만 둡니다.

## 패키지

```text
kr.myworkspace
├── Application.java                  # 앱 시작, 전체 하위 패키지 스캔
├── auth/                             # 로그인, 신뢰 네트워크, 비밀번호, OTP
│   ├── SecurityConfig.java
│   ├── AuthController.java
│   ├── SecuritySettingsController.java
│   ├── CredentialService.java
│   ├── SecurityState.java
│   └── Totp.java
├── calendar/
│   ├── event/                        # 일정 API·통합 조회·로컬 JPA 저장/버전 검증
│   ├── timetable/                    # 학기·수업·시간대와 겹침 검증
│   ├── holiday/                      # 저장 데이터 조회와 별도 공휴일 갱신
│   ├── icloud/                       # 연결·동기화 서비스, CalDAV/변환, 캐시 Repository
│   └── CalendarPreferencesController.java / CalendarVisibility.java
├── server/                           # Proxmox 상태 수집과 그래프 기록
│   ├── MonitoringController.java
│   ├── MonitoringService.java          # 실시간 스냅샷 조합과 수집 흐름
│   ├── ProxmoxClient.java / SensorClient.java
│   ├── MetricRepository.java           # 이력 저장·집계·보존
│   └── ServerStatusResponse.java / MetricHistoryResponse.java
├── wol/                              # PC 목록과 깨우기
│   ├── WolController.java
│   ├── WolService.java
│   ├── MagicPacketSender.java
│   └── WolDevice.java
├── settings/                         # 사이트 공통 설정
│   ├── SiteSettingsController.java
│   └── SiteName.java
└── common/                           # 여러 기능에서 사용하는 기반 코드
    ├── error/                        # ApiException, ApiExceptionHandler
    ├── document/                     # DocumentStore, AppDocument, DocumentRepository
    ├── crypto/                       # SecretCipher
    └── web/                          # HealthController
```

캘린더는 `event`, `timetable`, `holiday`, `icloud` 하위 기능으로 구분합니다. 통합 조회는 `event.ScheduleService`에서 공개 서비스 계약을 조합합니다. 각 하위 기능 안에서는 Controller·Service·Repository·Entity·DTO 이름으로 역할을 구분합니다. 비밀번호 설정은 인증 규칙·세션·OTP와 함께 바뀌므로 `settings` 대신 `auth`에 둡니다.

## 클래스 역할과 호출 방향

| 역할 | 책임 | 예시 |
|---|---|---|
| Controller | HTTP 입력 검증, 응답, 세션과 HTTPS 처리 | `ScheduleController`, `AuthController` |
| Service | 일정 규칙, 트랜잭션, 동기화, 수집 흐름 | `ScheduleService`, `CredentialService` |
| Repository | JPA 엔티티 조회·저장·잠금 | `EventRepository`, `DocumentRepository` |
| Entity | DB 테이블 매핑 | `StoredEvent`, `AppDocument` |
| 데이터 record | API 입력·출력과 저장 상태 | `EventInput`, `Course`, `SiteName`, `SecurityState` |
| 연동·변환 | 외부 통신과 프로토콜 변환 | `CalDavClient`, `ICalendarMapper`, `MagicPacketSender` |

기본 흐름은 **Controller → Service → Repository 또는 외부 연동 클래스**입니다. 값 하나를 저장하는 사이트 이름·표시 선택 API는 Controller에서 `DocumentStore`를 사용합니다. 별도 서비스가 필요한 독립 규칙이 생겼을 때 분리합니다. iCloud SQL과 캐시 보관은 `ICloudCacheRepository`가 담당합니다. `ICloudService`는 연결과 원격 작업을 조정합니다.

패키지 내부는 파일 이름으로 계층을 구분합니다. 작은 기능에 `controller/service/repository/dto/entity` 하위 폴더를 모두 만들지 않습니다. 하나의 기능이 더 커져 내부 경계를 나눌 필요가 생기면 그 기능 안에서만 하위 패키지를 추가합니다.

## 변경할 때 지킬 기준

1. 최상위 타입은 파일 하나에 하나씩 둡니다. 해당 API에서만 사용하는 작은 요청 record는 Controller 내부에 둘 수 있습니다.
2. 다른 기능의 내부 구현을 직접 참조하지 않습니다. 공통 코드도 특정 기능을 참조하지 않습니다.
3. 기능 코드는 `DocumentRepository`나 문서의 내부 필드에 접근하지 않고 `DocumentStore`의 조회·저장·잠금 메서드를 사용합니다. JSON 변환에는 Spring이 제공하는 `JsonMapper`를 직접 주입합니다.
4. `DocumentStore.lock()`으로 읽거나 갱신하는 작업은 호출 서비스의 트랜잭션 안에서 수행합니다. 기존 비밀번호·일정·WOL 잠금 범위를 유지합니다.
5. 내부 구현 타입과 상태는 가능한 한 패키지 내부에 둡니다. 공통 API와 외부에서 필요한 데이터 타입만 공개합니다.
6. 테스트도 같은 기능 패키지에 둡니다. 전체 기능을 함께 검증하는 `ApiIntegrationTest`는 테스트 루트에 유지합니다.
7. `Application`은 루트에 유지합니다. Spring 컴포넌트·JPA 엔티티·Repository가 하위 패키지에서 자동 검색됩니다.

## 구조 정리의 호환성

기존 API 경로와 암호화 형식을 유지합니다. 로컬 일정은 V7 마이그레이션으로 version을 추가하고 조회·저장 응답의 revision을 수정/삭제 요청에 사용합니다. 이전 데이터는 revision 0에서 시작합니다.

외부 CalDAV 통신은 로컬 DB 트랜잭션과 서비스 상태 잠금 밖에서 실행합니다. 조회는 기존 캐시를 반환하고 누락/만료 범위는 전용 작업자가 갱신합니다. 연결 세대와 캐시 변경 세대를 확인해 늦게 도착한 응답이 연결 해제·다른 연결·수정 결과를 덮어쓰지 않도록 합니다. 원격 변경 성공 후 캐시 저장이 실패하면 원격 성공을 반환하고 재동기화 대상으로 기록합니다. 로그에 캐시 실패를 남기며 다음 조회/주기 갱신에서 복구합니다.

공휴일 조회는 저장 데이터만 사용합니다. 누락 연도는 갱신 대상으로 등록하고 1분 주기 작업에서 가져오며, 성공한 데이터는 24시간 보관하고 실패 재시도에는 1분 간격을 적용합니다.

빌드는 과거 패키지의 클래스가 남아 문제를 가리지 않도록 다음과 같이 확인합니다.

```sh
./mvnw clean verify
```

기존 테스트를 새 위치에서 실행하고, 분리한 패킷 단위 테스트와 공통 상태 확인 API도 검증합니다. 실제 Apple 계정·Proxmox·PC 연동과 운영 배포는 별도 범위입니다.

모니터링 수집은 실시간 스냅샷을 먼저 발행하고 이력을 별도 실패 영역에서 저장합니다. DB 기록 실패는 로그와 historyFailed 상태로 남기고 정상 수집한 실시간 조회를 유지합니다. 수집 API 자체가 실패한 경우는 기존대로 조회 오류로 표시합니다. API 응답은 Java record로 필드·숫자·null 계약을 정의합니다.
