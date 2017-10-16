// Type definitions for node-firebird 0.8.3
// Project: node-firebird
// Definitions by: Marco Warm <https://github.com/MarcusCalidus>

declare module 'node-firebird' {
    type AttachCallback = (err: any, db: Database) => void;

    type TransactionCallback = (err: Options, transaction: Transaction) => void;
    type QueryCallback = (err: any, result: any[]) => void;
    type SimpleCallback = (err: any) => void;

    export const ISOLATION_READ_UNCOMMITTED: number[];
    export const ISOLATION_READ_COMMITED: number[];
    export const ISOLATION_REPEATABLE_READ: number[];
    export const ISOLATION_SERIALIZABLE: number[];
    export const ISOLATION_READ_COMMITED_READ_ONLY: number[];

    export type Isolation = number[];

    export interface Database {
        detach(callback?: SimpleCallback): void;
        transaction(isolation: Isolation, callback: TransactionCallback): void;
    }

    export interface Transaction {
        query(query: string, params: any[], callback: QueryCallback): void;
        execute(query: string, params: any[], callback: QueryCallback): void;
        commit(callback?: SimpleCallback): void;
        rollback(callback?: SimpleCallback): void; 
    }

    export interface Options {
        host?: string;
        port?: number;
        database?: string;
        user?: string;
        password?: string;
        lowercase_keys?: boolean;
        role?: string;           
        pageSize?: number; 
    }
    
    export function attach(options: any, callback: AttachCallback): void; 
}
