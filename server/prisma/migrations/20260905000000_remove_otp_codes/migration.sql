-- The OTP/SMS verification feature (and the Whish Money integration it was
-- built to gate) was removed before shipping - it will be reintroduced once
-- real Whish API credentials are available. This drops the table the
-- earlier `20260904180007_add_otp_codes` migration created, bringing the
-- database back in line with schema.prisma (which no longer declares
-- `OtpCode`).
DROP TABLE "OtpCode";
