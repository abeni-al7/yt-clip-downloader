interface Props {
  message: string;
  id?: string;
}

export function ErrorMessage({ message, id }: Props) {
  return (
    <p className="error" role="alert" id={id}>
      {message}
    </p>
  );
}
