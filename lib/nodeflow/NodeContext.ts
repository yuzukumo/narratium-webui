export class NodeContext {
  private inputStore: Map<string, any>;
  private cacheStore: Map<string, any>;
  private outputStore: Map<string, any>;

  constructor(inputData?: Record<string, any>, cacheData?: Record<string, any>, outputData?: Record<string, any>) {
    this.inputStore = new Map(Object.entries(inputData || {}));
    this.cacheStore = new Map(Object.entries(cacheData || {}));
    this.outputStore = new Map(Object.entries(outputData || {}));
  }

  setCache(key: string, value: any): void {
    this.cacheStore.set(key, value);
  }

  getCache(key: string): any {
    return this.cacheStore.get(key);
  }

  hasCache(key: string): boolean {
    return this.cacheStore.has(key);
  }

  setInput(key: string, value: any): void {
    this.inputStore.set(key, value);
  }

  getInput(key: string): any {
    return this.inputStore.get(key);
  }

  hasInput(key: string): boolean {
    return this.inputStore.has(key);
  }

  setOutput(key: string, value: any): void {
    this.outputStore.set(key, value);
  }

  getOutput(key: string): any {
    return this.outputStore.get(key);
  }

  hasOutput(key: string): boolean {
    return this.outputStore.has(key);
  }

  clearOutput(): void {
    this.outputStore.clear();
  }

  clearInput(): void {
    this.inputStore.clear();
  }

  clearCache(): void {
    this.cacheStore.clear();
  }

  clear(): void {
    this.inputStore.clear();
    this.cacheStore.clear();
    this.outputStore.clear();
  }

  toJSON(): Record<string, any> {
    return {
      inputStore: Object.fromEntries(this.inputStore),
      cacheStore: Object.fromEntries(this.cacheStore),
      outputStore: Object.fromEntries(this.outputStore),
    };
  }

  static fromJSON(json: Record<string, any>): NodeContext {
    const context = new NodeContext(json.inputStore, json.cacheStore, json.outputStore);
    return context;
  }
} 
