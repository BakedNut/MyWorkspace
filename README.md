# MyWorkspace

개인 일정과 학교 시간표, Proxmox 서버 상태, PC의 Wake-on-LAN을 한곳에서 관리하는 개인 웹사이트입니다.

<!-- TODO: 확인 필요 -->
<!-- 주 독자가 확정되면 설명 수준을 조정합니다. 현재 초안은 프로젝트를 처음 보는 개발자를 기준으로 작성했습니다. -->

## 주요 기능

- **메인** — 서울 시간 기준 날짜·12시간제 시계·초, 오늘과 선택한 날짜의 일정을 표시합니다.
- **캘린더와 시간표** — 일정 추가·수정·삭제, 공휴일 표시, 학기별 시간표를 제공합니다. 한 과목에 여러 수업 시간을 등록하고 시간별 강의실과 휴강일을 설정할 수 있습니다.
- **iCloud 연동** — HTTPS 화면에서 Apple ID와 앱 전용 암호로 캘린더를 연결합니다. 일반 일정은 편집하고, 반복·여러 날·초대 일정은 조회합니다.
- **서버 대시보드** — Proxmox 호스트와 VM·LXC의 자원 사용량을 기간별 그래프로 표시합니다. 스토리지 현황과 호스트 센서 연동 시 CPU 온도를 확인할 수 있습니다.
- **WOL** — PC 이름과 MAC 주소를 등록·수정·삭제하고 깨우기 패킷을 전송합니다. 전송 결과와 시각을 표시하며 같은 대상의 요청에는 10초 간격을 적용합니다.
- **접속과 설정** — 허용한 네트워크에서 자동 입장하고, 그 외 접속에는 비밀번호 로그인을 적용합니다. 사이트 이름·캘린더 표시 선택을 저장하고, 기존 비밀번호 또는 등록한 Google OTP로 비밀번호를 변경할 수 있습니다.

### 사용 기술

| 영역 | 기술 |
|---|---|
| 프론트엔드 | React, TypeScript, Vite, TanStack Router·Query, Tailwind CSS, Radix UI |
| 백엔드 | Java 21, Spring Boot, Spring Security, Spring Data JPA, JdbcTemplate |
| 데이터·연동 | MySQL 8.4, Flyway, iCloud CalDAV, ical4j, Proxmox API·SSH 센서 |
| 검증·운영 | JUnit, H2, Vitest, Testing Library, GitHub Actions, Nginx, systemd |

## 사용 방법

아래 명령어는 Linux·macOS의 셸을 기준으로 합니다. 프론트엔드는 Node.js 22.12 이상인 22.x와 npm을 사용합니다. 백엔드 빌드에는 Java 21과 저장소의 Maven Wrapper를 사용하며, 실제 API 실행에는 MySQL이 필요합니다.

### 1. 저장소 가져오기

기능 통합 브랜치인 develop을 내려받습니다.

```sh
git clone --branch develop https://github.com/BakedNut/MyWorkspace.git
cd MyWorkspace
```

### 2. 목업 데이터로 화면 실행하기

프론트엔드 디렉터리에서 의존성을 설치하고 미리보기 모드로 실행합니다.

```sh
cd FE
npm ci
VITE_API_MODE=mock npm run dev
```

브라우저에서 다음 주소를 엽니다.

```text
http://127.0.0.1:4173
```

목업 모드는 샘플 데이터로 화면 구성과 조작을 확인하는 용도입니다. 실제 계정 연동과 장치 제어는 실제 API 모드에서 사용합니다. 포트와 실행 설정은 프론트엔드 설정 파일에 정의되어 있습니다. [프론트엔드 안내](FE/README.md) · [Vite 설정](FE/vite.config.ts)

### 3. 백엔드 테스트와 빌드

저장소 루트에서 새 터미널을 열고 다음 명령어를 실행합니다.

```sh
cd BE
./mvnw clean verify
```

기본 통합 테스트는 H2의 MySQL 호환 모드를 사용합니다. 실제 MySQL 8.4 검증은 GitHub Actions의 별도 작업에서 실행합니다. 환경변수로 테스트 전용 DB를 지정하는 방법은 백엔드 안내에 있습니다. [백엔드 안내](BE/README.md) · [백엔드 CI](.github/workflows/be.yml)

### 4. 실제 API 실행하기

먼저 MySQL 데이터베이스와 애플리케이션·마이그레이션용 계정을 준비합니다. 다음 값을 실행 환경의 환경변수로 설정합니다.

| 환경변수 | 용도 |
|---|---|
| DB_URL | MySQL JDBC 연결 주소 |
| DB_USER / DB_PASSWORD | 애플리케이션 DB 계정 |
| DB_MIGRATION_USER / DB_MIGRATION_PASSWORD | Flyway 스키마 변경용 DB 계정 |
| APP_PASSWORD_HASH | 초기 로그인 비밀번호의 BCrypt 해시 |
| ICLOUD_KEY_FILE | iCloud·OTP 비밀정보 암호화 키 파일 경로. 부모 디렉터리는 미리 준비하고 실행 사용자에게 쓰기 권한을 부여합니다. |

아래 꺾쇠괄호 안의 값은 사용할 개발 환경의 값으로 교체합니다. BCrypt 해시의 달러 기호를 보존하도록 작은따옴표를 사용합니다.

```sh
export DB_URL='jdbc:mysql://<DB_HOST>:3306/<DB_NAME>?connectionTimeZone=UTC'
export DB_USER='<APP_DB_USER>'
export DB_PASSWORD='<APP_DB_PASSWORD>'
export DB_MIGRATION_USER='<MIGRATION_DB_USER>'
export DB_MIGRATION_PASSWORD='<MIGRATION_DB_PASSWORD>'
export APP_PASSWORD_HASH='<BCRYPT_HASH>'
export ICLOUD_KEY_FILE='<EXISTING_WRITABLE_DIRECTORY>/icloud-master.key'
```

<!-- TODO: 확인 필요 -->
<!-- 로컬 개발용 DB 생성·계정 권한 설정과 초기 BCrypt 해시 준비의 표준 절차를 확인해 보완합니다. -->

빌드를 마친 백엔드 디렉터리에서 실행합니다. 시작 시 Flyway가 마이그레이션을 적용하고 JPA가 스키마를 검증합니다.

```sh
java -jar target/myworkspace-0.0.1-SNAPSHOT.jar
```

다른 터미널에서 기본 상태 응답을 확인합니다.

```sh
curl --fail http://127.0.0.1:8080/api/health
```

```json
{"status":"ok"}
```

실제 API를 사용하는 화면에는 프론트엔드와 API 경로를 같은 출처로 연결하는 웹 서버 설정이 필요합니다. 저장소의 운영용 Nginx 설정은 API 요청을 백엔드로 전달합니다. [Nginx 설정](FE/deploy/nginx.conf)

<!-- TODO: 확인 필요 -->
<!-- 현재 Vite 설정에는 API 프록시가 없습니다. 로컬에서 프론트엔드와 백엔드를 함께 실행할 때 사용할 연결 절차를 확정합니다. -->

로컬 통합 실행의 API 연결 절차는 확인 후 보완할 예정입니다. 전체 환경변수와 백엔드 기능별 설정은 애플리케이션 설정 파일을 참고하세요. [애플리케이션 설정](BE/src/main/resources/application.properties)

### 5. 화면에서 연동 설정하기

1. HTTPS로 제공되는 사이트의 캘린더에서 iCloud 설정을 엽니다.
2. Apple ID와 앱 전용 암호를 입력하고 사용할 캘린더를 선택합니다.
3. 시간표 설정에서 학기 기간과 과목별 수업 시간을 저장합니다.
4. WOL 리스트 수정에서 대상 PC의 이름과 MAC 주소를 등록합니다.

Proxmox 모니터링에는 서버의 API 토큰과 센서 설정이 필요합니다. 현재 배포 스크립트는 Proxmox·LXC 환경을 대상으로 하며, 실제 접속 주소와 자격 증명은 실행 환경에서 관리합니다. 기능 사용과 배포 복구 절차는 운영 문서에 정리되어 있습니다. [사용·운영 문서](docs/backend-operations.md) · [배포 스크립트](BE/deploy)

## 프로젝트 구조

```text
MyWorkspace/
├── BE/
│   ├── src/main/java/kr/myworkspace/
│   │   ├── auth/                    # 로그인·비밀번호·OTP
│   │   ├── calendar/
│   │   │   ├── event/               # 일정 API·로컬 저장·버전 검증
│   │   │   ├── timetable/           # 학기·과목·수업 시간
│   │   │   ├── holiday/             # 공휴일 조회·갱신
│   │   │   └── icloud/              # 연결·동기화·이벤트 변경·캐시
│   │   ├── server/                  # Proxmox·센서·메트릭 이력
│   │   ├── wol/                     # PC 목록·깨우기 패킷
│   │   ├── settings/                # 사이트 설정
│   │   └── common/                  # 저장·암호화·오류 처리
│   ├── src/main/resources/db/migration/
│   ├── src/test/
│   ├── deploy/                      # 설치·배포·백업·센서 스크립트
│   └── docs/architecture.md
├── FE/
│   └── src/
│       ├── api/                     # 실제 API·목업 API
│       ├── components/              # 공통 화면 요소·설정 모달
│       ├── routes/                  # 페이지
│       └── lib/                     # 화면 로직·유틸리티
├── docs/                            # 설계·개발·운영 문서
└── .github/workflows/               # 프론트엔드·백엔드 CI
```

백엔드의 책임 분리와 호출 방향은 구조 안내에 설명되어 있습니다. [백엔드 구조 안내](BE/docs/architecture.md)
