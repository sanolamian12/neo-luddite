import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * dev 서버는 기본적으로 `localhost` 오리진만 신뢰하고, 그 외에서 온 dev 전용
   * 엔드포인트 요청(HMR 웹소켓 포함)은 **응답 없이 끊는다**.
   *
   * 그 증상이 고약하다: 브라우저는 ERR_INVALID_HTTP_RESPONSE 를 보고, HMR 소켓이
   * 죽으면서 **React 가 하이드레이션되지 않아** 화면은 뜨는데 폼·버튼이 전부 먹통이 된다.
   * `next build`/`next start` 는 멀쩡해서 "dev 만 깨졌다"로 오해하기 쉽다.
   *
   * 127.0.0.1 은 localhost 와 같은 곳이지만 오리진 문자열이 달라 차단된다 —
   * E2E 나 다른 기기에서 IP 로 접속할 때 걸린다. 명시적으로 허용한다.
   */
  allowedDevOrigins: ["127.0.0.1", "10.8.0.4"],

  turbopack: {
    /**
     * 워크스페이스 루트를 frontend/ 로 못박는다.
     *
     * Turbopack 은 lockfile 을 찾아 루트를 **자동 추론**한다. 이 저장소는 모노레포라
     * frontend/package-lock.json 이 있는데, 저장소 루트에도 lockfile 이 생기면
     * (예: 루트에서 npm i 를 한 번 하면) 그쪽을 루트로 골라 버린다.
     *
     * 그러면 dev 서버의 HMR 웹소켓 핸드셰이크가 깨지고(ERR_INVALID_HTTP_RESPONSE)
     * **React 가 하이드레이션되지 않는다** — 화면은 뜨는데 폼·버튼이 전부 먹통이 된다.
     * 빌드(next build)는 멀쩡해서 눈치채기 어렵다.
     *
     * 자동 추론에 맡기지 않고 고정해 그 사고를 원천 차단한다.
     */
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
