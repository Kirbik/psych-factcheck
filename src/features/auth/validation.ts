import { z } from "zod";

const secretWordSchema = z.object({
  secretWord: z
    .string()
    .max(200, "Кодовое слово слишком длинное")
    .refine((value) => {
      const length = Array.from(value.replace(/\s/g, "")).length;
      return length >= 3 && length <= 100;
    }, "Введите от 3 до 100 символов, не считая пробелы"),
});

const accessTokenSchema = z.object({
  token: z
    .string()
    .regex(/^pfc_[a-f0-9]{64}$/, "Введите корректный токен авторизации"),
});

export function parseSignUp(formData: FormData) {
  return secretWordSchema.safeParse({ secretWord: formData.get("secretWord") });
}

export function parseSignIn(formData: FormData) {
  return accessTokenSchema.safeParse({ token: formData.get("token") });
}

export const authTokenPattern = accessTokenSchema;
