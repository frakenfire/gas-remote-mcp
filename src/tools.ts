import { GasClient } from "./gasClient.js";
import { createPatch } from "diff";
import { script_v1 } from "googleapis";

const gasClient = GasClient.getInstance();

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

// 1. MCP Tools Definitions
export const TOOLS: ToolDefinition[] = [
  {
    name: "get_project_files",
    description: "Google Apps Script 프로젝트의 모든 파일(매니페스트 포함)을 가져옵니다.",
    inputSchema: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "대상 Apps Script 프로젝트의 고유 ID"
        }
      },
      required: ["scriptId"]
    }
  },
  {
    name: "preview_update_project_files",
    description: "코드 변경 전후의 diff 및 삭제/유실 위험성, 경고 사항을 보여줍니다. 실제 저장은 수행하지 않는 안전 단계입니다.",
    inputSchema: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "대상 Apps Script 프로젝트 ID"
        },
        files: {
          type: "array",
          description: "변경하거나 추가하려는 파일 목록 (명기되지 않은 파일은 기존대로 유지됩니다)",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "확장자를 제외한 파일 이름 (예: Code)" },
              type: { type: "string", description: "파일 타입 (SERVER_JS, HTML, JSON)" },
              source: { type: "string", description: "수정/대체될 전체 소스코드 내용" }
            },
            required: ["name", "type", "source"]
          }
        }
      },
      required: ["scriptId", "files"]
    }
  },
  {
    name: "update_project_files",
    description: "Google Apps Script 프로젝트 파일을 실제로 업데이트합니다. (주의: dryRun=false, confirm=true가 동시에 필요합니다)",
    inputSchema: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "대상 Apps Script 프로젝트 ID"
        },
        files: {
          type: "array",
          description: "수정 또는 추가하려는 파일 목록",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "파일 이름" },
              type: { type: "string", description: "파일 타입 (SERVER_JS, HTML, JSON)" },
              source: { type: "string", description: "파일 소스코드" }
            },
            required: ["name", "type", "source"]
          }
        },
        dryRun: {
          type: "boolean",
          description: "실제 저장을 방지하기 위한 안전 플래그. true 지정 시 수정하지 않습니다. (기본값: true)",
          default: true
        },
        confirm: {
          type: "boolean",
          description: "실제 코드 수정을 확인하는 명시적 동의 플래그. true여야만 저장이 완료됩니다. (기본값: false)",
          default: false
        }
      },
      required: ["scriptId", "files"]
    }
  },
  {
    name: "create_version",
    description: "Apps Script 프로젝트의 현재 상태에 대한 버전을 생성하고 버전 번호를 획득합니다.",
    inputSchema: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "대상 Apps Script 프로젝트 ID"
        },
        description: {
          type: "string",
          description: "이 버전에 대한 간략한 설명 기록"
        }
      },
      required: ["scriptId", "description"]
    }
  },
  {
    name: "deploy_project",
    description: "특정 버전을 기반으로 새로운 배포(Deployment)를 생성하거나 등록합니다.",
    inputSchema: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "대상 Apps Script 프로젝트 ID"
        },
        versionNumber: {
          type: "integer",
          description: "배포할 버전 번호"
        },
        description: {
          type: "string",
          description: "배포 상세 설명"
        }
      },
      required: ["scriptId", "versionNumber"]
    }
  },
  {
    name: "run_function",
    description: "Apps Script 프로젝트 내의 특정 함수를 원격으로 즉시 실행시킵니다.",
    inputSchema: {
      type: "object",
      properties: {
        scriptId: {
          type: "string",
          description: "대상 Apps Script 프로젝트 ID"
        },
        functionName: {
          type: "string",
          description: "실행하고자 하는 함수 이름"
        },
        parameters: {
          type: "array",
          description: "함수에 전달할 파라미터 배열",
          items: { type: "string" }
        }
      },
      required: ["scriptId", "functionName"]
    }
  }
];

// 2. Tools Handlers Implementation
export async function handleToolCall(name: string, args: any) {
  switch (name) {
    case "get_project_files": {
      const { scriptId } = args;
      gasClient.validateScriptId(scriptId);

      const content = await gasClient.getProjectContent(scriptId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              scriptId,
              files: content.files || []
            }, null, 2)
          }
        ]
      };
    }

    case "preview_update_project_files": {
      const { scriptId, files: incomingFiles } = args as { scriptId: string; files: script_v1.Schema$File[] };
      gasClient.validateScriptId(scriptId);

      const currentContent = await gasClient.getProjectContent(scriptId);
      const currentFiles = currentContent.files || [];

      const result = generateDiffAndSafetyReport(scriptId, currentFiles, incomingFiles);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2)
          }
        ]
      };
    }

    case "update_project_files": {
      const { scriptId, files: incomingFiles, dryRun = true, confirm = false } = args as {
        scriptId: string;
        files: script_v1.Schema$File[];
        dryRun: boolean;
        confirm: boolean;
      };
      gasClient.validateScriptId(scriptId);

      const currentContent = await gasClient.getProjectContent(scriptId);
      const currentFiles = currentContent.files || [];

      // 1. 병합(Merge) 진행: 전달된 파일로 대체하고, 전달되지 않은 기존 파일은 유지
      const mergedFilesMap = new Map<string, script_v1.Schema$File>();
      currentFiles.forEach((file) => {
        if (file.name) {
          mergedFilesMap.set(`${file.name}.${file.type}`, file);
        }
      });

      incomingFiles.forEach((file) => {
        if (file.name) {
          mergedFilesMap.set(`${file.name}.${file.type}`, file);
        }
      });

      const mergedFiles = Array.from(mergedFilesMap.values());

      // 2. 안전장치 검증: appsscript.json 매니페스트 파일 보존 확인
      const hasManifest = mergedFiles.some((f) => f.name === "appsscript" && f.type === "JSON");
      if (!hasManifest) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Safety Block: appsscript.json (appsscript) 파일이 대상 목록에 누락되었습니다. 프로젝트가 깨질 위험이 있어 중단합니다."
            }
          ]
        };
      }

      // 3. 파일 감소/삭제 위험 검토
      const deletionCount = currentFiles.filter(
        (cur) => !mergedFiles.some((m) => m.name === cur.name && m.type === cur.type)
      ).length;

      const report = generateDiffAndSafetyReport(scriptId, currentFiles, incomingFiles);

      if (dryRun || !confirm) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                message: "DryRun 또는 confirm이 누락되어 실제 반영되지 않았습니다. 반영을 원하시면 dryRun: false, confirm: true로 명시해주세요.",
                safetyReport: report
              }, null, 2)
            }
          ]
        };
      }

      // 4. [보안 로그 기록]
      console.log(`[WRITE LOG] timestamp=${new Date().toISOString()} scriptId=${scriptId} totalFiles=${mergedFiles.length} changedFiles=${incomingFiles.map(f => f.name).join(", ")} deletions=${deletionCount}`);

      // 5. 실제 반영
      const updatedContent = await gasClient.updateProjectContent(scriptId, mergedFiles);

      // 6. 다시 getContent로 정합성 validation 수행
      const verifyContent = await gasClient.getProjectContent(scriptId);
      const verifySuccess = incomingFiles.every((inc) =>
        verifyContent.files?.some(
          (v) => v.name === inc.name && v.type === inc.type && v.source === inc.source
        )
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: verifySuccess,
              message: verifySuccess
                ? "Apps Script 코드가 성공적으로 변경되었고 정합성 확인도 무사히 끝났습니다."
                : "API 변경 호출은 성공했으나, 반영된 소스코드 정합성 검증에 실패했습니다. 코드를 재확인해 주세요.",
              scriptId,
              updatedFilesCount: updatedContent.files?.length || 0
            }, null, 2)
          }
        ]
      };
    }

    case "create_version": {
      const { scriptId, description } = args;
      gasClient.validateScriptId(scriptId);

      const version = await gasClient.createVersion(scriptId, description);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              scriptId,
              versionNumber: version.versionNumber,
              description: version.description,
              createTime: version.createTime
            }, null, 2)
          }
        ]
      };
    }

    case "deploy_project": {
      const { scriptId, versionNumber, description } = args;
      gasClient.validateScriptId(scriptId);

      const deployment = await gasClient.createDeployment(scriptId, versionNumber, description);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              scriptId,
              deploymentId: deployment.deploymentId,
              versionNumber: deployment.deploymentConfig?.versionNumber || versionNumber,
              description: deployment.deploymentConfig?.description,
              url: `https://script.google.com/macros/s/${deployment.deploymentId}/exec`
            }, null, 2)
          }
        ]
      };
    }

    case "run_function": {
      const { scriptId, functionName, parameters = [] } = args;
      gasClient.validateScriptId(scriptId);

      const response = await gasClient.runFunction(scriptId, functionName, parameters);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              scriptId,
              functionName,
              status: "COMPLETED",
              response
            }, null, 2)
          }
        ]
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * 변경될 파일과 기존 파일을 비교하여 변경된 diff 및 위험 경고 리포트를 생성합니다.
 */
function generateDiffAndSafetyReport(
  scriptId: string,
  currentFiles: script_v1.Schema$File[],
  incomingFiles: script_v1.Schema$File[]
) {
  const patches: Record<string, string> = {};
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];
  const warnings: string[] = [];

  incomingFiles.forEach((incoming) => {
    const matched = currentFiles.find(
      (cur) => cur.name === incoming.name && cur.type === incoming.type
    );

    const fileType = incoming.type || "SERVER_JS";
    const fileName = `${incoming.name}.${fileType === "SERVER_JS" ? "gs" : fileType.toLowerCase()}`;

    if (!matched) {
      newFiles.push(fileName);
      patches[fileName] = `+++ NEW FILE: ${fileName}\n` + (incoming.source || "");
    } else {
      const oldSource = matched.source || "";
      const newSource = incoming.source || "";

      if (oldSource !== newSource) {
        modifiedFiles.push(fileName);
        const patch = createPatch(fileName, oldSource, newSource, "기존 코드", "수정 코드");
        patches[fileName] = patch;
      }
    }
  });

  const deletedFiles = currentFiles
    .filter(
      (cur) =>
        cur.name &&
        !incomingFiles.some((inc) => inc.name === cur.name && inc.type === cur.type) &&
        // merge 상황(일부 수정)이 아닌 전체 덮어쓰기 상황에서만 삭제 경고
        incomingFiles.some((inc) => inc.name === "appsscript") // 매니페스트 포함 시
    )
    .map((cur) => {
      const curType = cur.type || "SERVER_JS";
      return `${cur.name}.${curType === "SERVER_JS" ? "gs" : curType.toLowerCase()}`;
    });

  if (deletedFiles.length > 0) {
    warnings.push(
      `[위험] 아래 파일들이 원격 서버에서 삭제될 예정입니다: ${deletedFiles.join(", ")}`
    );
  }

  // 매니페스트 변경 유무 탐지
  const incomingManifest = incomingFiles.find((f) => f.name === "appsscript" && f.type === "JSON");
  const currentManifest = currentFiles.find((f) => f.name === "appsscript" && f.type === "JSON");
  if (incomingManifest && currentManifest && incomingManifest.source !== currentManifest.source) {
    warnings.push("[주의] appsscript.json 매니페스트 변경이 포함되어 있습니다. OauthScope나 라이브러리 설정에 영향이 없는지 재점검하세요.");
  }

  return {
    scriptId,
    newFiles,
    modifiedFiles,
    deletedFiles,
    patches,
    warnings,
    hasWarnings: warnings.length > 0
  };
}
