# LXC 배포와 테스트 환경

현재 배포 도구는 Proxmox 호스트의 root 환경에서 pct로 기존 LXC에 접근합니다. 웹 LXC 200과 MySQL LXC 202, 기존 DB·계정·환경 파일·systemd 서비스를 준비한 상태에서 사용합니다. 초기 구성은 설치 스크립트에서 확인할 수 있습니다. [초기 설치](../BE/deploy/initialize.py)

## 실행 구성

| 구분 | 웹·API | 서비스 | 데이터베이스 |
|---|---|---|---|
| 운영 | LXC 200의 Nginx 80 → Spring Boot 8080 | nginx, myworkspace | myworkspace |
| 테스트 | LXC 200의 테스트 웹 8088 → Spring Boot 8081 | myworkspace-preview-web, myworkspace-preview | myworkspace_preview |
| HTTPS 입구 | LXC 201 NPM → LXC 200 Nginx | 기존 NPM 설정 | 해당 환경의 DB |

Spring Boot는 loopback에서 수신합니다. 운영 Nginx는 React 정적 파일을 제공하고 API를 백엔드로 전달합니다. React 경로 직접 접속은 index.html로 연결합니다. API의 Cache-Control은 백엔드 응답 값을 전달합니다. 정상 아이콘은 private·1일 캐시를 사용하고 수집 대기·아이콘 없음은 no-store를 사용합니다. 화면 정적 파일은 no-store를 유지합니다. HTTPS와 외부 접근 허용 목록은 NPM에서 관리합니다. 신뢰 프록시와 자동 입장 조건은 운영 안내에서 설명합니다. [접속 경로](backend-operations.md#접속-경로와-자동-입장)

실제 환경 파일·비밀번호·연동 토큰과 DB·암호화 키 백업은 비공개로 관리합니다.

## 배포할 커밋 빌드

아래 명령어는 저장소 루트에서 실행합니다. Java 21과 Node.js 22.12 이상인 22.x가 필요합니다. 원격 develop을 가져오고 작업 상태를 확인한 뒤 빌드합니다.

```sh
git fetch origin
git switch develop
git merge --ff-only origin/develop
git status --short --branch
npm --prefix FE ci
npm --prefix FE run build
./BE/mvnw -f BE/pom.xml -DskipTests package
```

위 빌드 명령은 테스트를 생략하므로 배포할 커밋의 CI와 필요한 로컬 검증을 먼저 확인합니다. FE는 기본 실제 API 모드로 빌드합니다. 화면 시안용 목업 설정이 필요한 경우에는 별도 목업 실행 절차를 사용합니다. [개발 검증](development.md)

BE JAR에는 git.properties, FE에는 build-info.json이 생성됩니다. FE 메타데이터에는 커밋·작업 트리 변경 여부·빌드 파일 해시가 포함됩니다. 브랜치 이동이나 코드 수정 후에는 두 산출물을 다시 빌드합니다.

## 운영 배포

Proxmox 호스트의 저장소 루트에서 DB 백업과 격리 복원 검증을 수행합니다. 복원 검증은 별도 임시 DB를 만들고 검증 후 삭제합니다.

```sh
python3 BE/deploy/backup.py --verify
python3 BE/deploy/deploy.py
```

운영 배포 스크립트는 새 JAR·FE를 준비하고 Nginx 설정을 검사한 뒤 버전을 전환합니다. 백엔드의 정상 시작을 확인한 후 FE 링크와 Nginx를 갱신합니다. 기존 서비스 활성·자동 시작 상태, JAR·FE 링크와 설정을 기록해 실패 시 복구합니다. 복구 실패 시 예외에 표시된 임시 경로에 자료를 보존합니다. [운영 배포 코드](../BE/deploy/deploy.py)

배포 후 서비스를 점검합니다.

```sh
pct exec 200 -- systemctl is-active myworkspace nginx
pct exec 200 -- curl --fail http://127.0.0.1:8080/api/health
curl --fail http://192.168.1.200/api/health
```

브라우저에서 메뉴 이동·직접 접속·새로고침을 확인합니다. 같은 출처의 build-info.json과 배포한 JAR의 메타데이터·해시를 확인하고, 새 마이그레이션의 적용 결과도 확인합니다. NPM 경로는 해당 환경의 HTTPS 주소에서 별도로 점검합니다.

## 테스트 배포

테스트 배포 도구는 이미 구성된 테스트 서비스·DB·릴리스 링크를 사용합니다. 중지 상태라면 먼저 두 서비스를 시작합니다.

```sh
pct exec 200 -- systemctl start myworkspace-preview myworkspace-preview-web
python3 BE/deploy/preview.py
```

배포 시 JAR·FE의 현재 커밋 일치와 FE 전체 파일 해시를 검사하고, 빌드 산출물을 스냅샷으로 보관해 업로드합니다. 테스트 DB·암호화 키를 백업한 뒤 새 릴리스로 전환합니다. 전환 전 systemd ExecStartPre에 독립 DB 검사 프로그램을 등록합니다. 같은 서비스 환경의 Spring 설정을 읽고 런타임·Flyway 두 계정으로 실제 연결한 DB가 모두 myworkspace_preview인지 확인한 뒤 애플리케이션을 시작합니다. 검사 프로그램에는 Flyway·JPA 초기화를 등록하지 않습니다. 롤백 재시작도 이 검사를 거치므로 검사에서 참조하는 새 릴리스 JAR도 보존해야 합니다. DB 설정이 잘못되면 이전 버전도 시작을 거부하며 환경 설정을 수정한 후 재시작해야 합니다. 업로드한 파일 해시와 API 상태를 검사합니다. FE 전환 전후에 8081·8088의 배포 상태 API에서 같은 백엔드 인스턴스인지 확인하고, 해당 인스턴스의 실제 연결 DB가 myworkspace_preview인지 확인합니다. 결과가 다르면 이전 테스트 릴리스로 복구합니다. 실제 제공되는 HTML·JS·CSS와 build-info.json의 내용·미디어 타입·인코딩도 검사합니다. 백엔드만 바뀐 릴리스에서도 메타데이터의 HTTP 해시를 대조합니다. 실패 시 이전 테스트 릴리스로 복구합니다. CLI가 릴리스 전환 중 SIGTERM을 받으면 롤백 후 종료하며, 복구 중 추가 SIGTERM은 무시하고 기존 신호 처리기를 복원합니다. 배포 결과는 서버의 deployed-version.json과 로컬 .runtime/shortcuts-preview/deployment.json에 기록합니다. [테스트 배포 코드](../BE/deploy/preview.py)

테스트 주소와 API 상태를 확인합니다.

```sh
curl --fail http://192.168.1.200:8088/api/health
```

```text
http://192.168.1.200:8088/
```

테스트가 끝나면 서비스를 중지합니다.

```sh
pct exec 200 -- systemctl stop myworkspace-preview-web myworkspace-preview
pct exec 200 -- systemctl show myworkspace-preview-web myworkspace-preview -p Id -p ActiveState
```

## 최근 운영 확인

2026년 11월 16일 PR #7을 develop으로 병합한 e077184를 운영 LXC에 배포했습니다. 배포 전 DB 백업·격리 복원, V8·V9 마이그레이션, 제공되는 JAR·FE 해시와 PC·모바일 화면 진입·바로가기 API를 확인했습니다. 테스트 서비스는 중지 상태로 확인했습니다. 이 기록은 해당 배포 시점 기준입니다. [PR #7](https://github.com/BakedNut/MyWorkspace/pull/7)

## Tailscale 내부망 경로 점검

서브넷 경로의 광고·승인과 Proxmox 전달 방화벽을 함께 확인합니다. 기존 장애에서는 mywksp-forward 그룹 정의를 클러스터 규칙에 연결한 뒤 macOS의 내부망 접속이 복구됐습니다.

```text
[RULES]
GROUP mywksp-forward
```

실제 환경에서는 기존 그룹 정의·적용 규칙·IP 포워딩·SNAT·클라이언트 경로를 확인합니다. 도메인의 VPN 내부 DNS와 앱의 자동 입장 IP 판정도 함께 점검합니다. 상세 방화벽·허용 목록·백업은 비공개 운영 기록에서 관리합니다.
