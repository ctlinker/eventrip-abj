export type UserRole = 'client' | 'admin' | 'super_admin';

export type Permission =
	| 'payments:verify'
	| 'events:write'
	| 'convoys:write'
	| 'tickets:scan'
	| 'users:manage';

export type EventStatus = 'draft' | 'published' | 'archived';
export type ConvoyStatus = 'draft' | 'published' | 'cancelled';
export type TripType = 'one_way' | 'round_trip';

export type OrderStatus =
	| 'pending_payment'
	| 'under_review'
	| 'confirmed'
	| 'rejected'
	| 'expired'
	| 'cancelled';

export type OrderItemType = 'ticket_category' | 'convoy';
export type TicketItemType = 'event_ticket' | 'convoy_ticket';
export type TicketStatus = 'pending' | 'valid' | 'used' | 'cancelled';
export type PaymentStatus = 'pending' | 'confirmed' | 'rejected';

export function parsePermissions(raw: string | null | undefined): Permission[] {
	if (!raw) return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function hasPermission(
	user: { role: string; permissions?: string | null },
	permission: Permission,
): boolean {
	if (user.role === 'super_admin') return true;
	if (user.role !== 'admin') return false;
	return parsePermissions(user.permissions).includes(permission);
}
