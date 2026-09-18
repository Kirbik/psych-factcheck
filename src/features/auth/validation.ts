import { z } from "zod";

export const authCredentialsSchema = z.object({
  email: z.email("Введите корректный email."),
  password: z
    .string()
    .min(12, "Пароль должен содержать минимум 12 символов.")
    .max(128, "Пароль не должен превышать 128 символов."),
});

export type AuthCredentials = z.infer<typeof authCredentialsSchema>;

export function parseAuthCredentials(formData: FormData) {
  return authCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}
