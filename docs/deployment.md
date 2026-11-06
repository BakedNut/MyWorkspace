# LXC 디자인 시안 배포

## 배포 상태

- 대상: 웹앱 LXC 200, `192.168.1.200:80`.
- 내부망 주소: [MyWorkspace](http://192.168.1.200/).
- 기존 NPM 주소: [MyWorkspace HTTPS](https://wol.joonkee1219.duckdns.org/).
- NPM 201의 기존 프록시 대상과 접근 허용 목록은 변경하지 않았다.
- 시안 비밀번호: `demo`. 실제 인증이 아니며 데이터는 접속한 브라우저의 localStorage에 저장된다.
- 배포한 FE 소스: `5ad5305bea182f29a95d0fb4481150d65eff90f6`.
- 배포 디렉터리: `/var/www/myworkspace/releases/5ad5305-20261106022016Z`.
- 현재 경로: `/var/www/myworkspace/current` 심볼릭 링크.
- Nginx는 실행 중이며 LXC 부팅 시 자동으로 시작한다.

## 설정

저장소의 `FE/deploy/nginx.conf`를 LXC의 `/etc/nginx/nginx.conf`에 적용했다.

- Nginx와 firewalld는 내부망 `192.168.1.0/24`의 HTTP 접속을 허용한다. Nginx는 로컬 점검을 위해 loopback도 허용한다.
- NPM으로 들어오는 접속은 기존 NPM 접근 허용 목록을 추가로 적용받는다.
- React 페이지 직접 접속은 `index.html`로 연결한다.
- 없는 정적 파일은 404를 반환한다.
- 미구현 백엔드 경로 `/api/`는 503을 반환한다.
- 시안 수정 확인을 위해 브라우저 캐시는 `no-store`로 설정했다.

원래 Nginx 설정 백업: `/etc/nginx/nginx.conf.before-myworkspace-5ad5305-20261106022016Z`.

## 다음 화면 수정 배포

1. `FE/`에서 `npm ci`, 필요한 검사와 `npm run build`를 실행한다.
2. 빌드한 `dist/`를 새 release 디렉터리로 전송한다. 서버에는 소스나 `node_modules/`를 올리지 않는다.
3. `current` 심볼릭 링크를 새 release로 교체한다. 이전 release는 복구를 위해 보존한다.
4. Nginx 설정도 변경했다면 먼저 백업하고 `nginx -t` 성공 후 `systemctl reload nginx`를 실행한다.
5. 내부망과 HTTPS 주소에서 로그인, 페이지 직접 접속과 새로고침을 확인한다.

Nginx가 읽을 수 있도록 상위 디렉터리는 755, 빌드 파일은 644 권한을 유지한다. SSH 키와 실제 비밀정보는 저장소에 넣지 않는다.

## 검증

- LXC에서 Nginx 설정 검사와 서비스 자동 시작 확인.
- 모든 페이지의 HTTP 200 및 빌드한 index.html과 응답 파일 일치 확인.
- 잘못된 정적 파일의 404, 미구현 API의 503 확인.
- 일반 DNS 경로와 정상 인증서 검증을 통한 기존 NPM HTTPS 200 확인.
- 내부망·HTTPS 두 주소에서 PC(1440×1024)와 모바일(390×844)의 로그인, 네 페이지 이동, 직접 접속·새로고침, 모바일 메뉴를 검증했다. 페이지 실행 오류와 실패한 리소스 요청은 없었다.

백엔드, 실제 iCloud·Proxmox·WOL 하드웨어 연동은 이 배포에 포함하지 않는다.

## Tailscale 내부망 접속

웹 LXC의 `/32` 경로가 광고·승인되어 있어도 Proxmox의 전달 방화벽에서 허용해야 한다.

이번 접속 장애에서는 `mywksp-forward` 그룹이 정의되어 있었지만 `/etc/pve/firewall/cluster.fw`의 `[RULES]`에 연결되어 있지 않았다. 그룹 정의는 유지하고 아래 참조 한 줄을 추가해 적용했다.

```text
[RULES]
GROUP mywksp-forward
```

기존 규칙과 서브넷 광고 목록, IP 포워딩·SNAT 설정은 유지했다. 실제 nftables의 `cluster-forward`에서 그룹 호출이 생성된 것을 확인했고, 맥북에서 Tailscale을 통한 내부망 주소 접속이 복구되었다. 전체 방화벽 설정은 Git에 올리지 않고 Proxmox의 비공개 경로에 백업했다.
