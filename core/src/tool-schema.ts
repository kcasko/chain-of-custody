// Closed JSON-schema subset used by the agent tool definitions
// (policy/tools/evidence-tools.json). The Gateway only enforces type and
// required fields; everything else (closed objects, patterns, enums, limits)
// is enforced here. See ADR 0004 Stage B update.

export interface ToolSchema {
  type: 'object' | 'string' | 'integer' | 'array';
  properties?: Record<string, ToolSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: ToolSchema;
  pattern?: string;
  enum?: string[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minimum?: number;
}

export interface ToolDefinition { name: string; description: string; inputSchema: ToolSchema }

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

// Returns null when valid, otherwise a short reason naming the field.
export function checkAgainst(schema: ToolSchema, value: unknown, field = 'input'): string | null {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return `${field}: must be a string`;
      if (schema.minLength !== undefined && value.length < schema.minLength) return `${field}: too short`;
      if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${field}: too long`;
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) return `${field}: bad format`;
      if (schema.enum !== undefined && !schema.enum.includes(value)) return `${field}: not an allowed value`;
      return null;
    }
    case 'integer': {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) return `${field}: must be an integer`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${field}: below minimum`;
      return null;
    }
    case 'array': {
      if (!Array.isArray(value)) return `${field}: must be an array`;
      if (schema.minItems !== undefined && value.length < schema.minItems) return `${field}: too few items`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${field}: too many items`;
      if (schema.uniqueItems && new Set(value).size !== value.length) return `${field}: duplicate items`;
      if (!schema.items) return `${field}: schema has no item type`;
      for (let i = 0; i < value.length; i += 1) {
        const e = checkAgainst(schema.items, value[i], `${field}[${i}]`);
        if (e) return e;
      }
      return null;
    }
    case 'object': {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${field}: must be an object`;
      const props = schema.properties ?? {};
      for (const key of Object.keys(value)) if (!own(props, key)) return `${field}: unknown field ${key.slice(0, 64)}`;
      for (const key of schema.required ?? []) if (!own(value, key)) return `${field}: missing ${key}`;
      for (const [key, sub] of Object.entries(props)) {
        if (own(value, key)) {
          const e = checkAgainst(sub, (value as Record<string, unknown>)[key], key);
          if (e) return e;
        }
      }
      return null;
    }
    default:
      return `${field}: unsupported schema type`;
  }
}
