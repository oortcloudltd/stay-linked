const STRIP = [
  'bankAccountName', 'bankAccountNumber', 'bankName', 'bankCode', 'bankAccountVerified',
  'paystackRecipientCode', 'monnifyReservedAccountRef', 'commissionRate',
  'approvedBy', 'cacNumber', 'ownerId',
];

const round2 = (n) => (n == null ? n : Math.round(Number(n) * 100) / 100);

export function toPublicHotel(h) {
  if (!h) return h;
  const out = { ...h };

  STRIP.forEach((k) => delete out[k]);

  if (Array.isArray(out.rooms)) {
    out.rooms = out.rooms.map(({ roomNumber, ...room }) => room);
  }

  if (process.env.PUBLIC_EXACT_LOCATION === 'true') {
    return { ...out, locationExact: true };
  }

  delete out.googleMapsUrl;
  delete out.address;
  delete out.landmarks;

  out.latitude = round2(h.latitude);
  out.longitude = round2(h.longitude);
  out.locationExact = false;

  return out;
}