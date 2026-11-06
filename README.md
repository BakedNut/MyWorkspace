# MyWorkspace

개인 일정과 학교 시간표, Proxmox 모니터링, 두 PC의 Wake-on-LAN을 관리하는 개인 웹사이트입니다.

- `BE/`: Java 21 · Spring Boot · Spring Security · JPA · MySQL
- `FE/`: React · TypeScript · Vite
- `docs/`: 설계와 운영 문서

현재는 디자인 검토용 프론트엔드 시안 단계입니다. 실제 백엔드와 iCloud·Proxmox·WOL 연동은 아직 구현하지 않았습니다. 실행 방법은 [FE/README.md](FE/README.md)를 참고하세요.

## 브랜치

`feature/*` → PR → `develop` → 배포 PR → `main`

`main`은 배포 기준, `develop`은 기능 통합 브랜치입니다. 기능은 `develop`에서 분기하고 한글 커밋 메시지를 사용합니다.

## 비밀정보

SSH 키, 실제 환경 설정, 비밀번호와 연동 토큰은 저장소에 포함하지 않습니다.

## 검증

프론트엔드는 GitHub Actions에서 정적 빌드, 타입 검사, 단위 테스트와 린트를 실행합니다. 브라우저 검토 결과는 [FE/design-qa.md](FE/design-qa.md)에 기록합니다.
