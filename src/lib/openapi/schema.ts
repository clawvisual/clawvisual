import { appConfig } from "@/lib/config";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGE_CODES } from "@/lib/i18n/languages";

export function createOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: `${appConfig.name} API`,
      version: appConfig.version,
      description: "OpenAPI schema for clawvisual AI atomic skill pipeline"
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key"
        }
      },
      schemas: {
        ConvertRequest: {
          type: "object",
          required: ["input_text"],
          properties: {
            session_id: {
              type: "string",
              format: "uuid",
              description: "Conversation/session identifier. Reuse for multi-turn conversation continuity."
            },
            input_text: { type: "string" },
            max_slides: {
              type: "integer",
              minimum: 1,
              maximum: 8,
              default: 8,
              description: "Maximum slide count. System auto-selects final slide count up to this cap."
            },
            target_slides: {
              type: "integer",
              minimum: 1,
              maximum: 8,
              default: 8,
              deprecated: true,
              description: "Deprecated alias of max_slides for backward compatibility."
            },
            aspect_ratios: {
              type: "array",
              items: { type: "string", enum: ["4:5", "9:16", "1:1"] },
              default: ["4:5", "1:1"]
            },
            style_preset: { type: "string", default: "auto" },
            tone: { type: "string", default: "auto" },
            generation_mode: {
              type: "string",
              enum: ["standard", "quote_slides"],
              default: "quote_slides"
            },
            review_mode: {
              type: "string",
              enum: ["auto", "required"],
              default: "auto",
              description: "When required, pipeline returns multiple cover candidates for human confirmation."
            },
            output_language: {
              type: "string",
              enum: SUPPORTED_LANGUAGE_CODES,
              default: DEFAULT_LANGUAGE,
              description: "Target output language code"
            }
          }
        },
        ConvertResponse: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            session_id: { type: "string", format: "uuid" },
            status_url: { type: "string" }
          }
        },
        SessionResponse: {
          type: "object",
          properties: {
            session_id: { type: "string", format: "uuid" },
            title: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            last_job_id: { type: "string" },
            jobs: {
              type: "array",
              items: { $ref: "#/components/schemas/JobResponse" }
            }
          }
        },
        SessionSummary: {
          type: "object",
          properties: {
            session_id: { type: "string", format: "uuid" },
            title: { type: "string" },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            last_job_id: { type: "string" },
            job_count: { type: "integer" }
          }
        },
        SessionListResponse: {
          type: "object",
          properties: {
            sessions: {
              type: "array",
              items: { $ref: "#/components/schemas/SessionSummary" }
            }
          }
        },
        CreateSessionRequest: {
          type: "object",
          properties: {
            title: { type: "string", maxLength: 120 }
          }
        },
        UpdateSessionRequest: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string", minLength: 1, maxLength: 120 }
          }
        },
        ShareResponse: {
          type: "object",
          properties: {
            share_id: { type: "string" },
            session_id: { type: "string", format: "uuid" },
            share_token: { type: "string" },
            share_url: { type: "string" },
            visibility: { type: "string", enum: ["private", "public"] },
            expires_at: { type: "string", format: "date-time" },
            created_at: { type: "string", format: "date-time" }
          }
        },
        RegenerateAssetRequest: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string" },
            aspect_ratio: { type: "string", enum: ["4:5", "9:16", "1:1"], default: "4:5" },
            negative_prompt: { type: "string" }
          }
        },
        RegenerateAssetResponse: {
          type: "object",
          properties: {
            image_url: { type: "string" },
            used_fallback: { type: "boolean" },
            provider: { type: "string" },
            error: { type: "string" }
          }
        },
        AuditRequest: {
          type: "object",
          required: ["slides"],
          properties: {
            slides: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: {
                type: "object",
                required: ["slide_id", "content_quote", "image_url"],
                properties: {
                  slide_id: { type: "integer", minimum: 1 },
                  content_quote: { type: "string" },
                  image_url: { type: "string" },
                  visual_prompt: { type: "string" }
                }
              }
            },
            models: {
              type: "array",
              minItems: 1,
              maxItems: 5,
              items: { type: "string" }
            },
            output_language: { type: "string", default: DEFAULT_LANGUAGE },
            target_audience: { type: "string", default: "business readers" },
            platform: { type: "string", default: "Instagram" }
          }
        },
        AuditResponse: {
          type: "object",
          properties: {
            summary: {
              type: "object",
              properties: {
                models_requested: { type: "integer" },
                models_succeeded: { type: "integer" },
                overall_average_score: { type: "integer" }
              }
            },
            model_scores: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  model: { type: "string" },
                  status: { type: "string", enum: ["completed", "failed"] },
                  total_score: { type: ["integer", "null"] },
                  dimensions: {
                    type: ["object", "null"],
                    properties: {
                      readability: { type: "integer" },
                      aesthetics: { type: "integer" },
                      alignment: { type: "integer" }
                    }
                  },
                  critical_issue: { type: "string" },
                  fix_suggestion: { type: "string" },
                  error: { type: "string" }
                }
              }
            }
          }
        },
        ReviseJobRequest: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              enum: ["rewrite_copy_style", "regenerate_cover", "regenerate_slides"]
            },
            instruction: { type: "string" },
            instructions: { type: "string" },
            auto_route: {
              type: "boolean",
              default: true,
              description: "Let LLM intent router choose revision action when intent is omitted."
            },
            scope: {
              type: "object",
              properties: {
                slide_ids: { type: "array", items: { type: "integer", minimum: 1 } },
                fields: { type: "array", items: { type: "string" } }
              }
            },
            editable_fields: {
              type: "array",
              items: {
                type: "string",
                enum: ["post_title", "post_caption", "hashtags", "slides"]
              }
            },
            preserve_facts: { type: "boolean", default: true },
            preserve_slide_structure: { type: "boolean", default: true },
            options: {
              type: "object",
              properties: {
                mode: { type: "string", enum: ["same_prompt_new_seed", "reprompt"] },
                seed: { type: "integer" },
                preserve_layout: { type: "boolean", default: true }
              }
            }
          }
        },
        ReviseJobResponse: {
          type: "object",
          properties: {
            action: { type: "string", enum: ["revised", "ask_clarification", "full_regenerate"] },
            revision_id: { type: "string" },
            session_id: { type: "string", format: "uuid" },
            parent_job_id: { type: "string" },
            base_job_id: { type: "string" },
            turn_index: { type: "integer" },
            revision: { type: "integer" },
            status_url: { type: "string" },
            question: { type: "string" },
            regenerate_input_text: { type: "string" },
            changed_artifacts: { type: "array", items: { type: "string" } },
            rerun_plan: {
              type: "object",
              properties: {
                selectedSkills: { type: "array", items: { type: "string" } },
                reusedSkills: { type: "array", items: { type: "string" } },
                reason: { type: "string" }
              }
            },
            job: { $ref: "#/components/schemas/JobResponse" }
          }
        },
        JobResponse: {
          type: "object",
          properties: {
            job_id: { type: "string" },
            session_id: { type: "string", format: "uuid" },
            turn_index: { type: "integer" },
            revision: { type: "integer" },
            mode: { type: "string", enum: ["generate", "revise"] },
            base_job_id: { type: "string" },
            parent_job_id: { type: "string" },
            revision_intent: {
              type: "string",
              enum: ["rewrite_copy_style", "regenerate_cover", "regenerate_slides"]
            },
            input_text: { type: "string" },
            source_input_text: { type: "string" },
            status: { type: "string", enum: ["queued", "running", "completed", "failed"] },
            progress: { type: "integer" },
            stage: { type: "string" },
            rerun_plan: {
              type: "object",
              properties: {
                selectedSkills: { type: "array", items: { type: "string" } },
                reusedSkills: { type: "array", items: { type: "string" } },
                reason: { type: "string" }
              }
            },
            changed_artifacts: {
              type: "array",
              items: { type: "string" }
            },
            artifacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  artifactId: { type: "string" },
                  skillName: { type: "string" },
                  inputHash: { type: "string" },
                  output: { type: "object" },
                  version: { type: "integer" },
                  dependsOn: { type: "array", items: { type: "string" } },
                  revision: { type: "integer" },
                  updatedAt: { type: "string", format: "date-time" }
                }
              }
            },
            created_at: { type: "string", format: "date-time" },
            updated_at: { type: "string", format: "date-time" },
            result: {
              type: "object",
              properties: {
                post_title: { type: "string" },
                post_caption: { type: "string" },
                hashtags: { type: "array", items: { type: "string" } },
                source_evidence: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      title: { type: "string" },
                      excerpt: { type: "string" },
                      credibilityScore: { type: "integer" },
                      provider: { type: "string" },
                      reason: { type: "string" }
                    }
                  }
                },
                trend_signals: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      tag: { type: "string" },
                      score: { type: "integer" },
                      source: { type: "string" },
                      reason: { type: "string" }
                    }
                  }
                },
                platform_type: {
                  type: "string",
                  enum: ["RedBook", "Twitter", "Instagram", "TikTok", "LinkedIn"]
                },
                aspect_ratio: { type: "string", enum: ["4:5", "9:16", "1:1"] },
                slides: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      slide_id: { type: "integer" },
                      is_cover: { type: "boolean" },
                      content_quote: { type: "string" },
                      visual_prompt: { type: "string" },
                      image_url: { type: "string" },
                      layout_template: { type: "string" },
                      focus_keywords: { type: "array", items: { type: "string" } },
                      brand_overlay: {
                        type: "object",
                        properties: {
                          logo_position: { type: "string" },
                          color_values: {
                            type: "object",
                            properties: {
                              primary: { type: "string" },
                              secondary: { type: "string" },
                              background: { type: "string" },
                              text: { type: "string" }
                            }
                          },
                          font_name: { type: "string" },
                          logo_url: { type: "string" }
                        }
                      }
                    }
                  }
                },
                skill_logs: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      skill_name: { type: "string" },
                      status: { type: "string", enum: ["running", "completed", "failed"] },
                      output_preview: { type: "string" }
                    }
                  }
                },
                review: {
                  type: "object",
                  properties: {
                    required: { type: "boolean" },
                    reason: { type: "string" },
                    cover_candidates: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          label: { type: "string" },
                          visual_prompt: { type: "string" },
                          image_url: { type: "string" }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    paths: {
      "/api/v1/convert": {
        post: {
          summary: "Start skill chain conversion",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ConvertRequest" }
              }
            }
          },
          responses: {
            "202": {
              description: "Accepted",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ConvertResponse" }
                }
              }
            }
          }
        }
      },
      "/api/mcp": {
        post: {
          summary: "MCP JSON-RPC endpoint (initialize/tools/list/tools/call)",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    jsonrpc: { type: "string", example: "2.0" },
                    id: { oneOf: [{ type: "string" }, { type: "integer" }, { type: "null" }] },
                    method: { type: "string" },
                    params: { type: "object" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "JSON-RPC result payload"
            }
          }
        },
        get: {
          summary: "MCP endpoint metadata",
          responses: {
            "200": {
              description: "Endpoint metadata"
            }
          }
        }
      },
      "/api/v1/sessions": {
        get: {
          summary: "List session history",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "Session list",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionListResponse" }
                }
              }
            }
          }
        },
        post: {
          summary: "Create a new session thread",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateSessionRequest" }
              }
            }
          },
          responses: {
            "201": {
              description: "Created session",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/sessions/{id}": {
        get: {
          summary: "Get full session with all turns",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Session payload",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SessionResponse" }
                }
              }
            },
            "404": { description: "Not found" }
          }
        }
        ,
        patch: {
          summary: "Rename a session",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/UpdateSessionRequest" }
              }
            }
          },
          responses: {
            "200": { description: "Renamed session" },
            "400": { description: "Bad request" },
            "404": { description: "Not found" }
          }
        },
        delete: {
          summary: "Delete a session and related jobs",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Deleted" },
            "404": { description: "Not found" }
          }
        }
      },
      "/api/v1/sessions/{id}/share": {
        post: {
          summary: "Create a share link for a session",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Share link created",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ShareResponse" }
                }
              }
            },
            "404": { description: "Not found" }
          }
        }
      },
      "/api/v1/shares/{token}": {
        get: {
          summary: "Resolve share token to session payload",
          parameters: [
            {
              name: "token",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": { description: "Share payload" },
            "404": { description: "Not found or expired" }
          }
        }
      },
      "/api/v1/jobs/{id}": {
        get: {
          summary: "Get job status",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Job status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/JobResponse" }
                }
              }
            },
            "404": { description: "Not found" }
          }
        }
      },
      "/api/v1/jobs/{id}/revise": {
        post: {
          summary: "Create a revision from an existing job result with partial skill rerun",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReviseJobRequest" }
              }
            }
          },
          responses: {
            "202": {
              description: "Revision accepted and running",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReviseJobResponse" }
                }
              }
            },
            "400": { description: "Bad request" },
            "401": { description: "Unauthorized" },
            "404": { description: "Not found" },
            "409": { description: "Parent job not ready for revision" }
          }
        }
      },
      "/api/v1/assets/regenerate": {
        post: {
          summary: "Regenerate one slide image from edited prompt",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RegenerateAssetRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Image generated",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RegenerateAssetResponse" }
                }
              }
            },
            "400": { description: "Bad request" },
            "401": { description: "Unauthorized" }
          }
        }
      },
      "/api/v1/audit": {
        post: {
          summary: "Run multi-model multimodal audit scoring for final slides",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuditRequest" }
              }
            }
          },
          responses: {
            "200": {
              description: "Audit scores",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/AuditResponse" }
                }
              }
            },
            "400": { description: "Bad request" },
            "401": { description: "Unauthorized" }
          }
        }
      }
    }
  };
}
