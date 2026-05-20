import { google, script_v1 } from "googleapis";
import dotenv from "dotenv";

dotenv.config();

export class GasClient {
  private static instance: GasClient;
  private gas!: script_v1.Script;
  private allowedScriptIds: string[] = [];

  private constructor() {
    this.refreshConfig();
  }

  /**
   * 실시간 환경 변수 재로드 기능
   */
  public refreshConfig(): void {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (clientId && clientSecret && refreshToken) {
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: refreshToken });
      this.gas = google.script({ version: "v1", auth: oauth2Client });
    }

    const idsStr = process.env.ALLOWED_SCRIPT_IDS || "";
    this.allowedScriptIds = idsStr
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
  }

  private validateCredentials(): void {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken || !this.gas) {
      throw new Error(
        "Google 자격 증명 정보가 누락되었습니다. 웹 브라우저로 /config 페이지에 접속하여 설정을 완료해 주세요."
      );
    }
  }

  public static getInstance(): GasClient {
    if (!GasClient.instance) {
      GasClient.instance = new GasClient();
    }
    return GasClient.instance;
  }

  /**
   * 보안 검증: 요청된 scriptId가 허용 목록에 있는지 체크합니다.
   */
  public validateScriptId(scriptId: string): void {
    if (!scriptId) {
      throw new Error("scriptId is required.");
    }
    if (this.allowedScriptIds.length === 0) {
      throw new Error("ALLOWED_SCRIPT_IDS list is empty. No write/read access allowed. Configure .env file.");
    }
    if (!this.allowedScriptIds.includes(scriptId)) {
      throw new Error(
        `Access Denied: Script ID '${scriptId}' is not authorized. Add it to ALLOWED_SCRIPT_IDS in your .env configuration.`
      );
    }
  }

  /**
   * 프로젝트의 전체 파일 목록 조회
   */
  public async getProjectContent(scriptId: string): Promise<script_v1.Schema$Content> {
    this.validateScriptId(scriptId);
    this.validateCredentials();
    try {
      const response = await this.gas.projects.getContent({ scriptId });
      return response.data;
    } catch (error: any) {
      console.error(`Error in getProjectContent for ${scriptId}:`, error?.message || error);
      throw new Error(`Failed to get project content: ${error?.message || error}`);
    }
  }

  /**
   * 프로젝트 코드 일괄 업데이트
   */
  public async updateProjectContent(
    scriptId: string,
    files: script_v1.Schema$File[]
  ): Promise<script_v1.Schema$Content> {
    this.validateScriptId(scriptId);
    this.validateCredentials();

    // appsscript.json 매니페스트 파일 보존 안전장치
    const hasManifest = files.some((f) => f.name === "appsscript" && f.type === "JSON");
    if (!hasManifest) {
      throw new Error("Safety Block: The updates payload must contain 'appsscript.json' (appsscript) to avoid project corruption.");
    }

    try {
      const response = await this.gas.projects.updateContent({
        scriptId,
        requestBody: { files }
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error in updateProjectContent for ${scriptId}:`, error?.message || error);
      throw new Error(`Failed to update project content: ${error?.message || error}`);
    }
  }

  /**
   * 버전 생성
   */
  public async createVersion(
    scriptId: string,
    description: string
  ): Promise<script_v1.Schema$Version> {
    this.validateScriptId(scriptId);
    this.validateCredentials();
    try {
      const response = await this.gas.projects.versions.create({
        scriptId,
        requestBody: { description }
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error in createVersion for ${scriptId}:`, error?.message || error);
      throw new Error(`Failed to create script version: ${error?.message || error}`);
    }
  }

  /**
   * 배포(Deployment) 생성
   */
  public async createDeployment(
    scriptId: string,
    versionNumber: number,
    description?: string
  ): Promise<script_v1.Schema$Deployment> {
    this.validateScriptId(scriptId);
    this.validateCredentials();
    try {
      const response = await this.gas.projects.deployments.create({
        scriptId,
        requestBody: {
          versionNumber,
          description: description || `Deployed via Remote MCP`
        }
      });
      return response.data;
    } catch (error: any) {
      console.error(`Error in createDeployment for ${scriptId}:`, error?.message || error);
      throw new Error(`Failed to create deployment: ${error?.message || error}`);
    }
  }

  /**
   * 함수 즉시 실행
   */
  public async runFunction(
    scriptId: string,
    functionName: string,
    parameters: any[] = []
  ): Promise<any> {
    this.validateScriptId(scriptId);
    this.validateCredentials();
    try {
      // script.run은 실행에 필요한 추가 scope와 API 권한 설정이 필요할 수 있습니다.
      const response = await this.gas.scripts.run({
        scriptId,
        requestBody: {
          function: functionName,
          parameters,
          devMode: true
        }
      });

      const result = response.data;
      if (result.error) {
        throw new Error(
          `Execution Error: ${result.error.message || JSON.stringify(result.error.details)}`
        );
      }
      return result.response;
    } catch (error: any) {
      console.error(`Error running function ${functionName} on ${scriptId}:`, error?.message || error);
      throw new Error(`Failed to run script function: ${error?.message || error}`);
    }
  }
}
