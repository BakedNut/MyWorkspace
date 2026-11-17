# 개발 규칙

- `main`: 배포 기준. 기능을 직접 작성하지 않습니다.
- `develop`: 기능 통합과 배포 전 검증.
- `feature/<기능명>`: `develop`에서 분기하고 PR을 통해 통합.
- 커밋은 `feat: 일정 생성 구현`, `fix: 로그인 실패 처리 수정`처럼 소문자 유형과 한글 설명을 사용합니다.
- 기능 변경은 관련 검증을 완료한 뒤 GitHub에 업로드합니다.
- 환경 파일과 SSH 키, 비밀번호, API 토큰은 커밋하지 않습니다.

## 구조

```text
MyWorkspace/
├── BE/
├── FE/
└── docs/
```

백엔드는 기능별 패키지와 역할별 클래스로 구성합니다. 상세 기준은 [백엔드 구조 안내](../BE/docs/architecture.md)를 참고하세요.

## 로컬 실행과 검증

저장소 루트에서 실행합니다. Java 21과 Node.js 22.12 이상인 22.x가 필요합니다. 목업 화면은 다음과 같이 엽니다.

```sh
npm --prefix FE ci
VITE_API_MODE=mock npm --prefix FE run dev
```

브라우저 주소는 다음과 같습니다.

```text
http://127.0.0.1:4173/
```

실제 API 모드는 동일 출처의 웹 서버 연결이 필요합니다. 현재 Vite 설정에는 API 프록시가 없습니다. DB·환경변수와 백엔드 기동은 루트 README, LXC 연결은 배포 안내를 참고합니다. [README](../README.md) · [배포](deployment.md)

검증 명령은 다음과 같습니다.

```sh
npm --prefix FE test -- --maxWorkers=1
npm --prefix FE run typecheck
npm --prefix FE run lint
npm --prefix FE run build
./BE/mvnw -f BE/pom.xml clean verify
```

기본 BE 테스트는 H2의 MySQL 호환 모드를 사용합니다. MySQL 전용 테스트는 테스트 전용 DB의 환경변수를 지정해 실행하며 CI는 MySQL 8.4 서비스를 사용합니다. [BE 테스트 안내](../BE/README.md#mysql-통합-테스트)

배포 스크립트 회귀는 다음 명령으로 실행합니다. CI에서는 필요한 파일 접근 권한을 위해 sudo로 실행합니다.

```sh
sudo python3 -m unittest discover -s BE/deploy -p 'test_*.py' -v
```

## 바로가기 변경 검증

- 이름·URL·분류 추가·수정·삭제, 분류 접힘과 저장·새로고침을 확인합니다.
- 정리 모드의 그룹·링크 이동을 키보드·포인터·모바일 터치로 확인합니다. 빈 분류·접힌 분류도 포함합니다.
- 여러 탭에서 동시에 수정해 충돌 병합, 원격 삭제·이동과 저장 응답 유실 뒤 편집을 확인합니다. 같은 항목·같은 필드의 충돌은 현재 초안을 우선합니다.
- 최대 200개 링크의 병합 응답성과 아이콘 대기열의 지연 완료·최종 없음·URL 변경·페이지 종료 처리를 확인합니다.

최신 기준 테스트 수와 브라우저 검증 범위는 화면 검증 문서에 날짜·커밋과 함께 기록합니다. [검증 기록](../FE/design-qa.md)
