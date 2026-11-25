import type { Permission, UserRole } from 'db';

export interface AuthUser {
	id: string;
	email: string;
	name: string;
	phone?: string | null;
	role: UserRole;
	permissions: string;
	is_active: number;
}

export interface AuthSession {
	id: string;
	userId: string;
	expiresAt: Date;
	token: string;
}

export type AppEnv = {
	Bindings: Env;
	Variables: {
		user: AuthUser;
		session: AuthSession;
	};
};

export type RequiredPermission = Permission;
