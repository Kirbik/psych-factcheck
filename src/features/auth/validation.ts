import { z } from "zod";

const tokenSchema = z
  .string()
  .regex(/^pfc_[a-f0-9]{64}$/, "Введите корректный токен");
const signUpSchema = z.object({
  token: tokenSchema,
});

const accessTokenSchema = z.object({
  token: z
    .string()
    .regex(/^pfc_[a-f0-9]{64}$/, "Введите корректный токен авторизации"),
});

export function parseSignUp(formData: FormData) {
  return signUpSchema.safeParse({ token: formData.get("token") });
}

export function parseSignIn(formData: FormData) {
  return accessTokenSchema.safeParse({ token: formData.get("token") });
}

export const authTokenPattern = accessTokenSchema;
