import { z } from "zod";

export const authCredentialsSchema = z.object({
  email: z.email("Введите корректный email"),
  password: z
    .string()
    .min(12, "Пароль должен содержать минимум 12 символов")
    .max(128, "Пароль не должен превышать 128 символов"),
});

export const signUpCredentialsSchema = authCredentialsSchema
  .extend({
    passwordRepeat: z.string().min(1, "Повторите пароль"),
  })
  .refine((values) => values.password === values.passwordRepeat, {
    message: "Пароли не совпадают",
    path: ["passwordRepeat"],
  });

export type AuthCredentials = z.infer<typeof authCredentialsSchema>;

export function parseAuthCredentials(formData: FormData) {
  return authCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

export function parseSignUpCredentials(formData: FormData) {
  return signUpCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    passwordRepeat: formData.get("passwordRepeat"),
  });
}
