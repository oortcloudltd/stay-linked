export const STAFF_SESSION_SELECT = {
  id: true,
  name: true,
  email: true,
  hotelId: true,
  isActive: true,
  lastLogin: true,
  createdAt: true,
  hotel: { select: { id: true, name: true, isApproved: true, status: true } },
};

export function toSafeStaffSession(staff) {
  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    role: 'hotel_staff',
    hotelId: staff.hotelId,
    isActive: staff.isActive,
    lastLogin: staff.lastLogin,
    createdAt: staff.createdAt,
    hotel: staff.hotel,
  };
}