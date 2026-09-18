export type AuthActionState = {
  message?: string;
  fieldErrors?: {
    email?: string[];
    password?: string[];
  };
};

export const initialAuthActionState: AuthActionState = {};
