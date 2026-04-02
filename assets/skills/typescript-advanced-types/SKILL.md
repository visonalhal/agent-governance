# TypeScript Advanced Types

Comprehensive guidance for mastering TypeScript's advanced type system including generics, conditional types, mapped types, template literal types, and utility types.

## When to Use This Skill

- Building type-safe libraries or frameworks
- Creating reusable generic components
- Implementing complex type inference logic
- Designing type-safe API clients
- Building form validation systems
- Creating strongly-typed configuration objects
- Implementing type-safe state management

## Core Concepts

### 1. Generics

```typescript
// Generic Constraints
interface HasLength { length: number; }
function logLength<T extends HasLength>(item: T): T {
  console.log(item.length);
  return item;
}

// Multiple Type Parameters
function merge<T, U>(obj1: T, obj2: U): T & U {
  return { ...obj1, ...obj2 };
}
```

### 2. Conditional Types

```typescript
type IsString<T> = T extends string ? true : false;

// Extracting Return Types
type ReturnType<T> = T extends (...args: any[]) => infer R ? R : never;

// Distributive Conditional Types
type ToArray<T> = T extends any ? T[] : never;
type StrOrNumArray = ToArray<string | number>; // string[] | number[]
```

### 3. Mapped Types

```typescript
// Key Remapping
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

// Filtering Properties
type PickByType<T, U> = {
  [K in keyof T as T[K] extends U ? K : never]: T[K];
};
```

### 4. Template Literal Types

```typescript
type EventName = 'click' | 'focus' | 'blur';
type EventHandler = `on${Capitalize<EventName>}`;
// "onClick" | "onFocus" | "onBlur"
```

### 5. Utility Types

```typescript
Partial<T>       // Make all properties optional
Required<T>      // Make all properties required
Readonly<T>      // Make all properties readonly
Pick<T, K>       // Select specific properties
Omit<T, K>       // Remove specific properties
Exclude<T, U>    // Exclude types from union
Extract<T, U>    // Extract types from union
NonNullable<T>   // Exclude null and undefined
Record<K, T>     // Create object type with keys K and values T
```

## Advanced Patterns

### Type-Safe Event Emitter
### Type-Safe API Client
### Builder Pattern with Type Safety
### Deep Readonly/Partial
### Discriminated Unions

```typescript
type AsyncState<T> =
  | { status: 'success'; data: T }
  | { status: 'error'; error: string }
  | { status: 'loading' };
```

## Type Guards & Assertions

```typescript
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function assertIsString(value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error('Not a string');
}
```

## Best Practices

1. Use `unknown` over `any`
2. Prefer `interface` for object shapes
3. Use `type` for unions and complex types
4. Leverage type inference
5. Create helper types for reusability
6. Use const assertions to preserve literal types
7. Avoid type assertions — use type guards instead
8. Enable all strict compiler options
