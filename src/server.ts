import express, { Request, Response, NextFunction } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, handleToolCall } from "./tools.js";
import { google } from "googleapis";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

const PORT = process.env.PORT || 3000;
let BEARER_TOKEN = process.env.MCP_BEARER_TOKEN || "mcp_secret_token_1234!";

// .env가 존재하지 않으면 복사
const envPath = path.resolve(process.cwd(), ".env");
if (!fs.existsSync(envPath)) {
  const examplePath = path.resolve(process.cwd(), ".env.example");
  if (fs.existsSync(examplePath)) {
    let exampleContent = fs.readFileSync(examplePath, "utf-8");
    // 기본 무작위 토큰 심기
    exampleContent = exampleContent.replace("your_secure_mcp_bearer_token_here", BEARER_TOKEN);
    fs.writeFileSync(envPath, exampleContent, "utf-8");
  }
}

const app = express();

// Bearer Token 및 Query Token 보안 검증 미들웨어
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  if (!BEARER_TOKEN) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    if (token === BEARER_TOKEN) {
      return next();
    }
  }

  const queryToken = req.query.token as string;
  if (queryToken && queryToken === BEARER_TOKEN) {
    return next();
  }

  console.log(`[AUTH FAILED] Unauthorized request from ${req.ip} targeting ${req.path}`);
  res.status(401).json({ error: "Unauthorized: Invalid or missing bearer token." });
};

// URL Encoded & JSON Body Parser
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// =========================================================================
// 1. WEB CONFIGURATION UI & OAUTH CALLBACK HANDLERS (Premium Easy Setup)
// =========================================================================

// 임시 OAuth 저장을 위한 메모리 스토어
let tempClientConfig: { clientId?: string; clientSecret?: string } = {};

// 미려한 설정 화면 (Glassmorphism & Harmonious Dark Theme)
app.get("/config", (req: Request, res: Response) => {
  const isEnvConfigured =
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET &&
    !!process.env.GOOGLE_REFRESH_TOKEN;

  const html = `
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Google Apps Script MCP Setup Console</title>
      <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #0b0f19;
          --panel-bg: rgba(255, 255, 255, 0.03);
          --border-color: rgba(255, 255, 255, 0.08);
          --accent-primary: #3b82f6;
          --accent-success: #10b981;
          --accent-gradient: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
          --text-main: #f3f4f6;
          --text-muted: #9ca3af;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          font-family: 'Outfit', sans-serif;
          background-color: var(--bg-color);
          color: var(--text-main);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          overflow-x: hidden;
          background-image: 
            radial-gradient(at 10% 20%, rgba(59, 130, 246, 0.08) 0px, transparent 50%),
            radial-gradient(at 90% 80%, rgba(139, 92, 246, 0.08) 0px, transparent 50%);
        }
        .container {
          background: var(--panel-bg);
          border: 1px solid var(--border-color);
          backdrop-filter: blur(16px);
          border-radius: 24px;
          padding: 40px;
          width: 100%;
          max-width: 580px;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
          position: relative;
        }
        .container::before {
          content: '';
          position: absolute;
          top: -2px; left: -2px; right: -2px; bottom: -2px;
          background: var(--accent-gradient);
          border-radius: 26px;
          z-index: -1;
          opacity: 0.15;
        }
        h1 {
          font-size: 28px;
          font-weight: 700;
          margin-bottom: 8px;
          background: var(--accent-gradient);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        p.subtitle {
          color: var(--text-muted);
          font-size: 14px;
          margin-bottom: 30px;
          line-height: 1.5;
        }
        .status-badge {
          display: inline-flex;
          align-items: center;
          padding: 6px 12px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 600;
          margin-bottom: 24px;
          border: 1px solid;
        }
        .status-badge.configured {
          background: rgba(16, 185, 129, 0.08);
          color: var(--accent-success);
          border-color: rgba(16, 185, 129, 0.2);
        }
        .status-badge.pending {
          background: rgba(239, 68, 68, 0.08);
          color: #ef4444;
          border-color: rgba(239, 68, 68, 0.2);
        }
        .form-group {
          margin-bottom: 20px;
          text-align: left;
        }
        label {
          display: block;
          font-size: 13px;
          font-weight: 600;
          color: var(--text-muted);
          margin-bottom: 8px;
          letter-spacing: 0.5px;
        }
        input[type="text"] {
          width: 100%;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid var(--border-color);
          border-radius: 12px;
          padding: 14px 16px;
          color: var(--text-main);
          font-family: inherit;
          font-size: 14px;
          transition: all 0.3s ease;
        }
        input[type="text"]:focus {
          outline: none;
          border-color: var(--accent-primary);
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
        }
        .submit-btn {
          width: 100%;
          background: var(--accent-gradient);
          border: none;
          border-radius: 12px;
          padding: 16px;
          color: white;
          font-size: 15px;
          font-weight: 700;
          cursor: pointer;
          transition: transform 0.2s ease, opacity 0.2s ease;
          box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
          margin-top: 10px;
        }
        .submit-btn:hover {
          opacity: 0.95;
        }
        .submit-btn:active {
          transform: scale(0.98);
        }
        .info-card {
          margin-top: 24px;
          background: rgba(255, 255, 255, 0.01);
          border: 1px dashed var(--border-color);
          border-radius: 12px;
          padding: 16px;
          font-size: 12px;
          color: var(--text-muted);
          line-height: 1.6;
        }
        .info-card a {
          color: var(--accent-primary);
          text-decoration: none;
        }
        .info-card a:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Google Apps Script MCP Setup</h1>
        <p class="subtitle">CLI 환경 없이 구글 API 연동을 논스톱으로 완료해 보세요.</p>
        
        <div class="status-badge ${isEnvConfigured ? "configured" : "pending"}">
          연동 상태: ${isEnvConfigured ? "● 연동 완료 (동작 중)" : "○ 설정 필요 (자격증명 미승인)"}
        </div>

        <form action="/config" method="POST">
          <div class="form-group">
            <label for="clientId">GOOGLE_CLIENT_ID</label>
            <input type="text" id="clientId" name="clientId" placeholder="Google Cloud Console에서 획득한 Client ID 입력" value="${process.env.GOOGLE_CLIENT_ID || ""}" required>
          </div>
          <div class="form-group">
            <label for="clientSecret">GOOGLE_CLIENT_SECRET</label>
            <input type="text" id="clientSecret" name="clientSecret" placeholder="Google Cloud Console에서 획득한 Client Secret 입력" value="${process.env.GOOGLE_CLIENT_SECRET || ""}" required>
          </div>
          <button type="submit" class="submit-btn">인증 토큰 발급 & 동의하기</button>
        </form>

        <div class="info-card">
          <strong>도움말:</strong><br>
          1. <a href="https://console.cloud.google.com" target="_blank">Google Cloud Console</a>에서 <strong>Apps Script API</strong>를 활성화하세요.<br>
          2. 사용자 동의 화면(OAuth Consent Screen)의 테스트 사용자에 본인 이메일을 추가해야 합니다.<br>
          3. OAuth Client ID 생성 시 리디렉션 URI에 현재 도메인의 <code>/oauth2callback</code> 또는 <code>http://localhost:3000/oauth2callback</code>를 반드시 추가하세요.
        </div>
      </div>
    </body>
    </html>
  `;
  res.send(html);
});

// 설정 제출 시 OAuth 인증 페이지 생성 및 리다이렉트
app.post("/config", (req: Request, res: Response) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).send("Client ID and Secret are required.");
  }

  tempClientConfig = { clientId, clientSecret };

  // 프로토콜(http/https)과 Host를 감지하여 유연한 Callback URL 생성
  const protocol = req.headers["x-forwarded-proto"] || "http";
  const redirectUri = `${protocol}://${req.headers.host}/oauth2callback`;

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/script.projects",
      "https://www.googleapis.com/auth/script.deployments",
      "https://www.googleapis.com/auth/script.processes",
      "https://www.googleapis.com/auth/drive.metadata.readonly"
    ],
    prompt: "consent"
  });

  res.redirect(authUrl);
});

// Google OAuth 인증 완료 Callback 엔드포인트
app.get("/oauth2callback", async (req: Request, res: Response) => {
  const code = req.query.code as string;
  if (!code) {
    return res.status(400).send("Authorization code is missing.");
  }

  const clientId = tempClientConfig.clientId || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = tempClientConfig.clientSecret || process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(400).send("Client configuration lost. Please re-submit from /config.");
  }

  try {
    const protocol = req.headers["x-forwarded-proto"] || "http";
    const redirectUri = `${protocol}://${req.headers.host}/oauth2callback`;

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      // 리프레시 토큰이 안 올 시 가이드
      return res.status(400).send(`
        <h3>리프레시 토큰 발급 실패</h3>
        <p>Google이 새로운 Refresh Token을 발급하지 않았습니다. 기존 앱 승인을 취소한 뒤 다시 시도해 주세요.</p>
        <p><a href="/config">이전 화면으로 돌아가기</a></p>
      `);
    }

    // 1. .env 파일 자동 업데이트
    let envContent = "";
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf-8");
    } else {
      const examplePath = path.resolve(process.cwd(), ".env.example");
      if (fs.existsSync(examplePath)) {
        envContent = fs.readFileSync(examplePath, "utf-8");
      }
    }

    const replaceOrAppend = (content: string, key: string, val: string) => {
      const regex = new RegExp(`^${key}=.*$`, "m");
      return regex.test(content) ? content.replace(regex, `${key}=${val}`) : content + `\n${key}=${val}`;
    };

    let newEnvContent = replaceOrAppend(envContent, "GOOGLE_CLIENT_ID", clientId);
    newEnvContent = replaceOrAppend(newEnvContent, "GOOGLE_CLIENT_SECRET", clientSecret);
    newEnvContent = replaceOrAppend(newEnvContent, "GOOGLE_REFRESH_TOKEN", refreshToken);

    fs.writeFileSync(envPath, newEnvContent, "utf-8");

    // 2. process.env 실시간 갱신 반영
    process.env.GOOGLE_CLIENT_ID = clientId;
    process.env.GOOGLE_CLIENT_SECRET = clientSecret;
    process.env.GOOGLE_REFRESH_TOKEN = refreshToken;

    // 3. 싱글톤 클라이언트 초기화 트리거
    try {
      // 기동 상태에 따라 싱글톤 재지정 가능하도록 보완
      const { GasClient } = await import("./gasClient.js");
      // @ts-ignore
      GasClient.instance = null; // 재싱글톤 바인딩 트리거를 위해 초기화
      GasClient.getInstance();
    } catch (e) {
      console.warn("GasClient reinitialization delayed until next tool call:", e);
    }

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>연동 성공!</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          body {
            font-family: 'Outfit', sans-serif;
            background: #0b0f19;
            color: #f3f4f6;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            text-align: center;
          }
          .box {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 20px;
            padding: 40px;
            max-width: 500px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
          }
          h2 { color: #10b981; margin-bottom: 12px; }
          p { color: #9ca3af; font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
          .btn {
            background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%);
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            text-decoration: none;
            display: inline-block;
          }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>★ Google Apps Script MCP 연동 성공! ★</h2>
          <p>구글 API 자격 증명(OAuth 2.0 Refresh Token)이 .env 파일에 안전하게 기록되었습니다.<br>이제 브라우저 창을 닫고 ChatGPT 웹으로 넘어가 대화를 나누셔도 됩니다.</p>
          <a href="/config" class="btn">설정 센터로 가기</a>
        </div>
      </body>
      </html>
    `);
  } catch (err: any) {
    console.error("OAuth Exchange Error:", err);
    res.status(500).send(`OAuth Error: ${err.message || err}`);
  }
});

// =========================================================================
// 2. MODEL CONTEXT PROTOCOL PROTOCOL IMPLEMENTATION (SSEServerTransport)
// =========================================================================

// =========================================================================
// 2. MODEL CONTEXT PROTOCOL PROTOCOL IMPLEMENTATION (SSEServerTransport)
// =========================================================================

// 세션별로 Transport와 Server 인스턴스를 관리하기 위한 Map
interface ActiveSession {
  transport: SSEServerTransport;
  server: Server;
}
const activeSessions = new Map<string, ActiveSession>();

// SSE Handshake 엔드포인트
app.get("/sse", authenticate, async (req: Request, res: Response) => {
  console.log(`[SSE CONNECTION] Client initiated SSE handshake. IP=${req.ip}`);
  
  // 1. 새로운 SSEServerTransport 인스턴스 생성
  const sessionTransport = new SSEServerTransport("/message", res);
  const sessionId = sessionTransport.sessionId;
  console.log(`[SSE CONNECTION] Session created: ${sessionId}`);

  // 2. 이 세션을 위한 개별 Server 인스턴스 생성
  const sessionServer = new Server(
    {
      name: "google-apps-script-remote-mcp",
      version: "1.0.0"
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // 3. Tools 핸들러 등록
  sessionServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: TOOLS
    };
  });

  sessionServer.setRequestHandler(CallToolRequestSchema, async (request: any) => {
    try {
      const { name, arguments: args } = request.params;
      const result = await handleToolCall(name, args);
      return result;
    } catch (error: any) {
      console.error(`Tool Execution Error in session ${sessionId}:`, error?.message || error);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `[Error] ${error?.message || error}`
          }
        ]
      };
    }
  });

  // 4. 세션 맵에 등록
  activeSessions.set(sessionId, {
    transport: sessionTransport,
    server: sessionServer
  });

  // 5. 서버에 트랜스포트 연결
  sessionServer.connect(sessionTransport).catch((err: any) => {
    console.error(`Failed to connect transport for session ${sessionId}:`, err);
  });

  // 6. 클라이언트 연결 종료 시 리소스 정리
  req.on("close", async () => {
    console.log(`[SSE CONNECTION CLOSED] Session closed: ${sessionId}`);
    const session = activeSessions.get(sessionId);
    if (session) {
      try {
        await session.server.close();
      } catch (e) {
        console.error(`Error closing server for session ${sessionId} on disconnect:`, e);
      }
      activeSessions.delete(sessionId);
    }
  });
});

// SSE 메시지 수신 엔드포인트
app.post("/message", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  if (!sessionId) {
    console.warn("[POST /message] Missing sessionId query parameter.");
    res.status(400).send("Missing sessionId query parameter.");
    return;
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    console.warn(`[POST /message] No active session found or unauthorized for ID: ${sessionId}`);
    res.status(401).send(`Unauthorized or Session not found for ID: ${sessionId}`);
    return;
  }

  try {
    await session.transport.handlePostMessage(req, res);
  } catch (err: any) {
    console.error(`Error handling POST message for session ${sessionId}:`, err);
    res.status(500).send(err.message || "Internal server error");
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", service: "Google Apps Script Remote MCP" });
});

// Express 서버 실행
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`  Google Apps Script Remote MCP Server is running!`);
  console.log(`  Local Endpoint: http://localhost:${PORT}`);
  console.log(`  Web Setup Console: http://localhost:${PORT}/config`);
  console.log(`  SSE Connection URL: http://localhost:${PORT}/sse`);
  console.log("==================================================");
});
