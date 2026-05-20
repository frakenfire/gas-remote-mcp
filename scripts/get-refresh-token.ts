import { google } from "googleapis";
import http from "http";
import url from "url";
import fs from "fs";
import path from "path";
import readline from "readline";
import dotenv from "dotenv";

dotenv.config();

const PORT = 8085;
const REDIRECT_URI = `http://localhost:${PORT}`;
const SCOPES = [
  "https://www.googleapis.com/auth/script.projects",
  "https://www.googleapis.com/auth/script.deployments",
  "https://www.googleapis.com/auth/script.processes",
  "https://www.googleapis.com/auth/drive.metadata.readonly"
];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("==================================================");
  console.log("  Google Apps Script MCP OAuth2 Token Helper");
  console.log("==================================================\n");

  let clientId = process.env.GOOGLE_CLIENT_ID || "";
  let clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  if (!clientId) {
    clientId = await question("Enter GOOGLE_CLIENT_ID: ");
  } else {
    console.log(`Using GOOGLE_CLIENT_ID from .env: ${clientId.substring(0, 10)}...`);
  }

  if (!clientSecret) {
    clientSecret = await question("Enter GOOGLE_CLIENT_SECRET: ");
  } else {
    console.log(`Using GOOGLE_CLIENT_SECRET from .env: ${clientSecret.substring(0, 5)}...`);
  }

  if (!clientId || !clientSecret) {
    console.error("Client ID and Client Secret are required.");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    REDIRECT_URI
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent"
  });

  console.log("\n--------------------------------------------------");
  console.log("다음 URL을 브라우저에 붙여넣고 구글 로그인을 진행하세요:");
  console.log(authUrl);
  console.log("--------------------------------------------------\n");
  console.log("로그인 완료 시 로컬 인증 서버가 인증 코드를 자동으로 수신합니다...\n");

  // 임시 HTTP 서버 기동하여 Redirect 가로채기
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = url.parse(req.url || "", true);
      const code = parsedUrl.query.code as string;

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html>
            <body style="font-family: sans-serif; text-align: center; padding-top: 50px; background: #f4f7f6;">
              <div style="display: inline-block; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                <h2 style="color: #2e7d32;">인증 성공!</h2>
                <p>Google Apps Script MCP 서버가 코드를 성공적으로 수신했습니다.</p>
                <p>이제 이 브라우저 창을 닫고 터미널로 돌아가셔도 됩니다.</p>
              </div>
            </body>
          </html>
        `);

        console.log("인증 코드를 수신했습니다. Refresh Token을 발급받는 중...");

        const { tokens } = await oauth2Client.getToken(code);
        const refreshToken = tokens.refresh_token;

        if (refreshToken) {
          console.log("\n==================================================");
          console.log("★ Refresh Token 획득 성공! ★");
          console.log("--------------------------------------------------");
          console.log(refreshToken);
          console.log("==================================================\n");

          updateEnvFile(clientId, clientSecret, refreshToken);
        } else {
          console.log("\n[주의] Access Token은 발급되었으나 Refresh Token이 없습니다.");
          console.log("기존 승인을 취소하거나 브라우저 로그인 창에서 'consent' 프롬프트에 동의하셨는지 확인하세요.");
          if (tokens.access_token) {
            console.log("발급된 임시 Access Token:", tokens.access_token);
          }
        }

        server.close(() => {
          rl.close();
          process.exit(0);
        });
      } else {
        res.writeHead(404);
        res.end("Not Found");
      }
    } catch (err) {
      console.error("인증 처리 도중 에러 발생:", err);
      res.writeHead(500);
      res.end("Internal Server Error");
      server.close(() => {
        rl.close();
        process.exit(1);
      });
    }
  });

  server.listen(PORT, () => {
    console.log(`인증 대기 중... (http://localhost:${PORT} 리스닝 중)`);
  });
}

function updateEnvFile(clientId: string, clientSecret: string, refreshToken: string) {
  const envPath = path.resolve(process.cwd(), ".env");
  let envContent = "";

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf-8");
  } else {
    // .env.example 복사본 만들기
    const examplePath = path.resolve(process.cwd(), ".env.example");
    if (fs.existsSync(examplePath)) {
      envContent = fs.readFileSync(examplePath, "utf-8");
    }
  }

  // 기존 키-값 갱신 또는 추가
  const newContent = replaceOrAppend(envContent, "GOOGLE_CLIENT_ID", clientId)
    .replaceOrAppend("GOOGLE_CLIENT_SECRET", clientSecret)
    .replaceOrAppend("GOOGLE_REFRESH_TOKEN", refreshToken);

  fs.writeFileSync(envPath, newContent.content, "utf-8");
  console.log(".env 파일에 인증 정보가 성공적으로 반영되었습니다! (직접 확인해 보세요)");
}

// 헬퍼 메소드 추가하기 위한 프로토타입 또는 로컬 유틸 클래스
class EnvModifier {
  content: string;
  constructor(content: string) {
    this.content = content;
  }

  replaceOrAppend(key: string, value: string): EnvModifier {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(this.content)) {
      this.content = this.content.replace(regex, `${key}=${value}`);
    } else {
      this.content += `\n${key}=${value}`;
    }
    return this;
  }
}

function replaceOrAppend(content: string, key: string, value: string) {
  return new EnvModifier(content).replaceOrAppend(key, value);
}

main().catch((err) => {
  console.error("Fatal Error:", err);
  rl.close();
  process.exit(1);
});
