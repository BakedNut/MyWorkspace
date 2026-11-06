# MyWorkspace 프론트엔드 시안

Lovable에서 검토한 파스텔 블루 화면을 React·TypeScript·Vite 정적 앱으로 구성했습니다. 메인, 캘린더, 서버 대시보드, WOL, 로그인 화면을 제공합니다.

## 실행과 검증

Node.js 22.12 이상인 22.x 버전을 사용합니다.

```sh
npm ci
npm run build
npm run typecheck
npm test
npm run lint
npm run dev
```

빌드 결과는 `dist/`입니다. 운영 시 Nginx에서 정적 파일을 제공하고, 페이지 직접 접속을 위해 `try_files $uri $uri/ /index.html;`을 설정합니다. `vite preview`는 로컬 확인용입니다.

현재 시안은 200번 LXC의 Nginx에 배포했습니다. 접속 주소와 갱신 절차는 [배포 문서](../docs/deployment.md)를 참고하세요.

## 시안과 실제 서비스의 구분

- 로그인 비밀번호는 공개된 시안용 값 `demo`입니다. 실제 접근 제어 기능이 아닙니다.
- 일정, 시간표, MAC 주소는 브라우저 localStorage에 저장됩니다. 서버에 동기화되지 않습니다.
- iCloud, 서버 상태와 WOL은 샘플 동작이며 실제 계정 연결이나 매직 패킷 전송은 하지 않습니다.
- 서버 장애 상태와 저장 실패는 화면에서 시험할 수 있습니다.
- 날짜와 시간은 브라우저 설정과 관계없이 Asia/Seoul을 사용합니다.
- 실제 인증, 네트워크 신뢰, CSRF 보호, 캘린더 동기화, MySQL 저장은 Spring Boot에서 구현해야 합니다.

`src/api/client.ts`는 화면의 API 계약, `src/api/mock/`은 시안용 구현입니다. 실제 REST 구현은 이 계약을 만족하도록 작성한 뒤 `src/api/index.ts`에서 교체합니다.

## 시간표 편집

캘린더의 ‘시간표 설정’에서 요일·시간 표를 편집합니다. 빈 칸을 누르면 수업을 추가하고, 수업 블록이나 ‘편집할 수업’ 목록에서 선택해 과목명·강의실·교수명·요일·시작/종료·휴강일을 수정합니다. ‘시간표 저장’이 전체 초안을 저장하며 취소하면 폐기합니다. 키보드로는 ‘수업 추가’와 수업 선택 목록을 사용할 수 있습니다.

30분 칸에서 추가한 뒤 `18:25–19:15`처럼 1분 단위로 조정할 수 있습니다. 같은 요일의 겹치는 수업은 저장하지 않으며, 주말·기본 표시 시간 밖 수업은 표를 자동 확장합니다. 교수명 필드가 없는 기존 브라우저 저장 데이터도 그대로 읽습니다.

Firecrawl로 [FullCalendar의 TimeGrid](https://fullcalendar.io/docs/timegrid-view)와 [MDN의 CSS Grid 줄 배치](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Grid_layout/Line-based_placement)를 검토했습니다. 고정 요일 시간표에는 기존 React 구성과 CSS Grid를 사용해 별도 달력 라이브러리 없이 분 단위로 수업을 배치했습니다. 드래그 이동·이미지 자동 인식은 이번 범위에 포함하지 않습니다.

## 디자인 원본

[Lovable 프로젝트](https://lovable.dev/projects/2ce9597e-59a1-4aa7-b6a9-25795b4556b2)의 생성 소스를 가져왔습니다. GitHub의 `FE/`가 타입 오류 수정과 정적 앱 전환을 반영한 작업 기준입니다. Lovable 원본에는 로컬 수정이 자동 반영되지 않습니다.
