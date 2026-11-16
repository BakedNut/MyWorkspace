# Backend

Java 21 · Spring Boot · Spring Security · JPA · JdbcTemplate · MySQL을 사용합니다.

```sh
./mvnw verify
```

통합 테스트는 H2의 MySQL 모드로 별도 실행합니다. 운영 스키마는 Flyway로 관리합니다. 실행 환경값과 계정 정보는 저장소에 포함하지 않습니다.

## 구조

인증(`auth`)·일정/시간표(`calendar`)·서버 상태(`server`)·바로가기(`shortcuts`)·WOL(`wol`)·사이트 설정(`settings`)을 기능별 패키지로 관리합니다. 각 기능 안에서 Controller·Service·Repository·데이터 클래스를 파일별로 구분하며 공통 저장·암호화·오류 처리는 `common`에 둡니다.

구조 선택 이유와 호출 방향, 새 코드를 추가할 위치는 구조 안내에 설명합니다. 구조 변경 후에는 BE 디렉터리에서 clean 빌드로 검증합니다. [백엔드 구조 안내](docs/architecture.md)

```sh
./mvnw clean verify
```

## 기능

- 로그인과 사용자 설정, 일정·공휴일·시간표, 바로가기, 서버 모니터링, WOL API를 제공합니다.
- 한 과목에 여러 수업 시간을 저장하며 각 시간의 휴강일·강의실과 전체 시간 겹침을 검사합니다. 기존 시간표도 읽을 수 있습니다.
- iCloud 연결은 웹 설정에서 진행합니다. 일반 일정은 편집하고 반복·여러 날·초대 일정은 조회합니다.
- 비밀번호 변경은 기존 비밀번호 또는 등록한 Google OTP로 확인합니다. OTP 등록도 별도 확인 절차를 거칩니다.
- 사이트 이름을 서버에 저장합니다. 로그인 화면에서 사용할 이름 조회만 공개하고 변경은 기존 인증과 CSRF 보호를 적용합니다. 공백만 있는 값·제어 문자·40자를 넘는 이름은 거부합니다.
- 서버 기록은 `1m · 15m · 1H · 6H · 12H · 1D · 1W · 1M` 범위를 지원합니다. 1H는 1분, 6H는 5분, 12H는 10분 단위의 평균 기록을 반환하며 누락 구간은 비어 있는 값으로 유지합니다.

호스트 센서 수집에는 `SENSOR_KEY`, `SENSOR_TARGET`, `SENSOR_KNOWN_HOSTS`를 운영 환경에서 지정합니다. 실제 접속 주소·계정·경로는 코드에 포함하지 않습니다.

화면과의 계약은 [API 인터페이스](../FE/src/api/client.ts)를 참고하세요. 운영 환경별 접근 정보와 복구 자료는 비공개로 관리합니다.

## 캘린더 표시 설정

인증된 `GET /api/calendar/visibility`와 CSRF가 필요한 `PUT /api/calendar/visibility`로 `hiddenCalendarIds`를 조회·저장합니다. 학교 시간표는 `__school`, iCloud는 각 캘린더 ID를 사용하며 MySQL의 별도 문서에 저장합니다. 초기값은 전체 표시입니다. 일정·시간표 원본은 변경하지 않습니다.

## 바로가기 API

모든 바로가기 API는 인증이 필요하며 목록 저장에는 CSRF 토큰도 필요합니다.

| 요청 | 동작 |
|---|---|
| GET /api/shortcuts | revision과 분류·링크 목록 조회 |
| PUT /api/shortcuts | 전체 목록 저장. 이전 revision이면 409 CONFLICT |
| GET 또는 HEAD /api/shortcuts/icons/{id} | 저장된 링크의 사이트 아이콘 조회. site 쿼리는 현재 URL의 출처와 비교 |

최대 분류 50개·전체 링크 200개를 지원합니다. 분류 이름은 80자, 링크 이름은 120자, URL은 2,048자까지이며 HTTP·HTTPS URL을 검증합니다. 이름의 앞뒤 공백을 제거하고 공백만 있는 이름·제어 문자를 거부합니다. 문서 잠금 안에서 revision을 확인하고 저장 시 증가시킵니다.

V8은 app_document에 초기 바로가기 문서를 추가하고, V9는 shortcut_icon 캐시 테이블을 만듭니다. 캐시는 출처별로 공유하며 정상 아이콘은 7일, 아이콘 없음은 6시간 보관합니다. 외부 수집은 작업자 2개·대기열 32개로 제한합니다. 수집 대기·대기열 포화는 202와 Retry-After, 수집 완료 후 아이콘 없음은 204, 정상 이미지는 200을 반환합니다. 아직 수집 결과가 없으면 공유 작업을 유지하며 즉시 202를 반환합니다.

아이콘 다운로드에는 DNS 주소 고정, 대상 주소·포트·리디렉션 검사와 8초 수집 제한을 적용합니다. 이미지는 검증·정화 후 저장합니다. 사설망 아이콘 접근 범위는 SHORTCUT_ICON_NETWORKS로 지정하며 실제 환경에 맞게 설정합니다. 자세한 책임 분리는 구조 안내에 있습니다. [백엔드 구조](docs/architecture.md)

## MySQL 통합 테스트

기본 테스트는 H2에서 실행합니다. CI의 별도 mysql 작업은 MySQL 8.4 서비스에서 V1~V9 마이그레이션과 로컬 일정 revision/동시 갱신·삭제, 바로가기 revision 충돌·아이콘 캐시, WOL 잠금/예약, iCloud 캐시 날짜/읽기전용 메타데이터, 메트릭 SQL 집계를 검증합니다. MYSQL_TEST_URL, MYSQL_TEST_USERNAME, MYSQL_TEST_PASSWORD로 비어 있는 테스트 전용 DB를 지정한 뒤 BE 디렉터리에서 실행합니다.

```sh
./mvnw -Dtest=MySqlIntegrationTest verify
```

배포 스크립트 테스트는 CI에서 별도로 실행합니다. [개발 검증](../docs/development.md#로컬-실행과-검증)
