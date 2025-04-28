import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text
} from 'jsx-email';

interface TemplateProps {
  email: string;
  name: string;
}

const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif'
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  marginBottom: '64px',
  padding: '20px 0 48px'
};

const box = {
  padding: '0 48px'
};

const hr = {
  borderColor: '#e6ebf1',
  margin: '20px 0'
};

const paragraph = {
  color: '#777',
  fontSize: '16px',
  lineHeight: '24px',
  textAlign: 'left' as const
};

const anchor = {
  color: '#777'
};

const button = {
  fontWeight: 'bold',
  padding: '10px',
  textDecoration: 'none'
};

export const previewProps: TemplateProps = {
  email: 'batman@example.com',
  name: 'Bruce Wayne'
};

export const templateName = 'mail';

export const Template = ({ email, name }: TemplateProps) => (
  <Html>
    <Head />
    <Preview>This is our email preview text for {name} &lt;{email}&gt;</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={box}>
          <Text style={paragraph}>This is our email body text</Text>
          <Button
            align={'center'}
            backgroundColor={'#777'}
            borderRadius={5}
            fontSize={16}
            height={60}
            href="https://example.com"
            style={button}
            textColor={'#fff'}
            width={160}
          >
            Action Button
          </Button>
          <Hr style={hr} />
          <Text style={paragraph}>
            This is text content with a{' '}
            <Link style={anchor} href="mailto:{email}">
              link
            </Link>
            .
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
);
