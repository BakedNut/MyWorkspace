# MyWorkspace

개인 일정과 학교 시간표, Proxmox 모니터링, 등록한 PC의 Wake-on-LAN을 관리하는 개인 웹사이트입니다.

- `BE/`: Java 21 · Spring Boot · Spring Security · JPA · MySQL
- `FE/`: React · TypeScript · Vite
- `docs/`: 설계와 운영 문서

200번 LXC에서 React·Nginx·Spring Boot, 202번 LXC에서 MySQL 8.4를 실행합니다. 일정·시간표·WOL 목록을 DB에 저장하며 Proxmox 상태와 기록을 실제로 수집합니다. iCloud 계정 연동은 추후 진행합니다. 실행 방법은 [FE/README.md](FE/README.md), [BE/README.md](BE/README.md), [운영 문서](docs/backend-operations.md)를 참고하세요.

## 브랜치

`feature/*` → PR → `develop` → 배포 PR → `main`

`main`은 배포 기준, `develop`은 기능 통합 브랜치입니다. 기능은 `develop`에서 분기하고 한글 커밋 메시지를 사용합니다.

## 비밀정보

SSH 키, 실제 환경 설정, 비밀번호와 연동 토큰은 저장소에 포함하지 않습니다.

## 검증

GitHub Actions에서 프론트엔드 빌드·타입·테스트·린트와 백엔드 통합 테스트·빌드를 실행합니다. 브라우저 검토 결과는 [FE/design-qa.md](FE/design-qa.md), 실제 연동 검증은 [운영 문서](docs/backend-operations.md)에 기록합니다.
