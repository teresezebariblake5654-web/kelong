import type { OperatorFn } from './types.js';

export class OperatorRegistry {
  private readonly operators = new Map<string, OperatorFn>();

  register(name: string, fn: OperatorFn): this {
    if (this.operators.has(name)) {
      throw new Error(`Operator already registered: ${name}`);
    }
    this.operators.set(name, fn);
    return this;
  }

  has(name: string): boolean {
    return this.operators.has(name);
  }

  get(name: string): OperatorFn {
    const fn = this.operators.get(name);
    if (!fn) {
      throw new Error(`Unknown operator: ${name}`);
    }
    return fn;
  }

  list(): string[] {
    return [...this.operators.keys()].sort();
  }
}

export function createDefaultOperatorRegistry(): OperatorRegistry {
  // Operators are registered by registerBuiltinOperators to avoid circular imports.
  return new OperatorRegistry();
}
